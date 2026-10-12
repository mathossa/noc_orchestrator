import { describe, expect, it, vi } from 'vitest'
import {
  ArubaCentralApiError,
  arubaCentralApiBaseUrl,
  listNewCentralDevices,
  requestNewCentralAccessToken,
} from '@/lib/aruba-central-api-client'

const configuration = {
  variant: 'NEW' as const,
  baseUrl: 'https://de1.api.central.arubanetworks.com',
}
const credentials = {
  clientId: 'DUMMY_CLIENT_ID',
  clientSecret: 'DUMMY_CLIENT_SECRET',
}
const tokenResponse = () =>
  new Response(JSON.stringify({ access_token: 'DUMMY_TOKEN', expires_in: 7200 }), {
    status: 200,
  })

describe('HPE Aruba New Central API client', () => {
  it('requires the matching HTTPS gateway and prevents cross-product token leakage', () => {
    expect(arubaCentralApiBaseUrl(configuration).origin).toBe(
      'https://de1.api.central.arubanetworks.com',
    )
    expect(() =>
      arubaCentralApiBaseUrl({
        variant: 'NEW',
        baseUrl: 'https://apigw-prod2.central.arubanetworks.com',
      }),
    ).toThrow('New Central')
    expect(() =>
      arubaCentralApiBaseUrl({
        variant: 'CLASSIC',
        baseUrl: configuration.baseUrl,
      }),
    ).toThrow('Classic Central')
    for (const baseUrl of [
      'http://de1.api.central.arubanetworks.com',
      'https://de1.api.central.arubanetworks.com.evil.test',
      'https://token@de1.api.central.arubanetworks.com',
      'https://de1.api.central.arubanetworks.com/untrusted',
    ]) {
      expect(() => arubaCentralApiBaseUrl({ variant: 'NEW', baseUrl })).toThrow()
    }
  })

  it('requests a Central-scoped client-credentials token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tokenResponse())
    await expect(
      requestNewCentralAccessToken({ credentials, fetchImpl }),
    ).resolves.toBe('DUMMY_TOKEN')

    const [target, init] = fetchImpl.mock.calls[0]
    expect(String(target)).toBe(
      'https://sso.common.cloud.hpe.com/as/token.oauth2',
    )
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    )
    const body = init?.body as URLSearchParams
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe(credentials.clientId)
    expect(body.get('client_secret')).toBe(credentials.clientSecret)
  })

  it('reads every page with the documented next cursor, preserves offline status', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      calls.push(url.toString())
      if (url.hostname === 'sso.common.cloud.hpe.com') return tokenResponse()
      const next = url.searchParams.get('next')
      if (!next) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'SERIAL1',
                serialNumber: 'SERIAL1',
                deviceName: 'HQ-AP01',
                status: 'OFFLINE',
                deviceType: 'ACCESS_POINT',
                softwareVersion: '10.6.0.2_90095',
              },
            ],
            count: 1,
            total: 2,
            next: '2',
          }),
        )
      }
      expect(next).toBe('2')
      return new Response(
        JSON.stringify({
          items: [{ id: 'SERIAL2', serialNumber: 'SERIAL2', status: 'ONLINE' }],
          next: null,
        }),
      )
    }

    const devices = await listNewCentralDevices({
      configuration,
      credentials,
      fetchImpl,
    })
    expect(devices).toHaveLength(2)
    expect(devices[0].status).toBe('OFFLINE')
    expect(calls).toHaveLength(3)
    expect(new URL(calls[1]).pathname).toBe('/network-monitoring/v1/devices')
    expect(new URL(calls[1]).searchParams.get('limit')).toBe('1000')
    expect(new URL(calls[2]).searchParams.get('next')).toBe('2')
  })

  it('retries 429 with Retry-After and bounded 5xx backoff', async () => {
    const sleep = vi.fn(async () => undefined)
    let deviceRequests = 0
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('token.oauth2')) return tokenResponse()
      deviceRequests += 1
      if (deviceRequests === 1) {
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '2' },
        })
      }
      if (deviceRequests === 2) return new Response(null, { status: 503 })
      return new Response(JSON.stringify({ items: [], next: null }))
    }
    await expect(
      listNewCentralDevices({
        configuration,
        credentials,
        fetchImpl,
        requestPolicy: { sleep, maxAttempts: 3, baseDelayMs: 100 },
      }),
    ).resolves.toEqual([])
    expect(deviceRequests).toBe(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 2000)
    expect(sleep).toHaveBeenNthCalledWith(2, 200)
  })

  it('gets a fresh access token once when a device request returns 401', async () => {
    let tokenCount = 0
    let deviceCount = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).includes('token.oauth2')) {
        tokenCount += 1
        return new Response(JSON.stringify({ access_token: `TOKEN-${tokenCount}` }))
      }
      deviceCount += 1
      const header = new Headers(init?.headers).get('Authorization')
      if (deviceCount === 1) {
        expect(header).toBe('Bearer TOKEN-1')
        return new Response(null, { status: 401 })
      }
      expect(header).toBe('Bearer TOKEN-2')
      return new Response(JSON.stringify({ items: [], next: null }))
    }
    await listNewCentralDevices({ configuration, credentials, fetchImpl })
    expect(tokenCount).toBe(2)
    expect(deviceCount).toBe(2)
  })

  it('fails closed on duplicate pagination cursors or incomplete/invalid pages', async () => {
    for (const payloads of [
      [{ items: [], next: '2' }, { items: [], next: '2' }],
      [{ items: [], next: '2' }, { message: 'not a device page' }],
      [{ items: [], next: '2' }, { items: [null], next: null }],
    ]) {
      let index = 0
      const fetchImpl: typeof fetch = async (input) => {
        if (String(input).includes('token.oauth2')) return tokenResponse()
        return new Response(JSON.stringify(payloads[index++]))
      }
      await expect(
        listNewCentralDevices({ configuration, credentials, fetchImpl }),
      ).rejects.toBeInstanceOf(ArubaCentralApiError)
    }
  })

  it('does not retry authorization errors or leak credentials/provider response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ error: credentials.clientSecret }),
        { status: 403 },
      ),
    )
    try {
      await requestNewCentralAccessToken({ credentials, fetchImpl })
      throw new Error('Expected the token request to fail.')
    } catch (error) {
      expect(error).toBeInstanceOf(ArubaCentralApiError)
      expect((error as Error).message).not.toContain(credentials.clientSecret)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
