import { describe, expect, it, vi } from 'vitest'
import {
  listMerakiOrganizationDevices,
  listMerakiOrganizationDeviceAvailabilities,
  listMerakiOrganizationNetworks,
  listMerakiOrganizations,
  MerakiApiError,
} from '@/lib/meraki-api-client'

const credentials = { apiKey: 'DUMMY_MERAKI_KEY' }

describe('Meraki Dashboard API client', () => {
  it('uses Bearer auth without leaking the secret into errors', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify([{ id: '1', name: 'Org' }]), {
        status: 200,
      })
    }
    await expect(
      listMerakiOrganizations({ environment: 'global', credentials, fetchImpl }),
    ).resolves.toEqual([{ id: '1', name: 'Org' }])
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer DUMMY_MERAKI_KEY')
    expect(calls[0].url).toBe('https://api.meraki.com/api/v1/organizations')
  })

  it('follows RFC Link pagination for organization devices', async () => {
    const requested: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input))
      if (requested.length === 1) {
        return new Response(
          JSON.stringify([
            { networkId: 'N1', serial: 'Q1', model: 'MR36' },
          ]),
          {
            status: 200,
            headers: {
              Link: '<https://api.meraki.com/api/v1/organizations/1/devices?perPage=1000&startingAfter=Q1>; rel="next"',
            },
          },
        )
      }
      return new Response(
        JSON.stringify([
          { networkId: 'N1', serial: 'Q2', model: 'MR36' },
        ]),
        { status: 200 },
      )
    }
    const devices = await listMerakiOrganizationDevices({
      environment: 'global',
      organizationId: '1',
      credentials,
      fetchImpl,
    })
    expect(devices.map((device) => device.serial)).toEqual(['Q1', 'Q2'])
    expect(requested).toHaveLength(2)
  })

  it('uses the organization networks endpoint with pagination', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          { id: 'N1', organizationId: '1', name: 'Site 1' },
        ]),
        { status: 200 },
      )
    const networks = await listMerakiOrganizationNetworks({
      environment: 'global',
      organizationId: '1',
      credentials,
      fetchImpl,
    })
    expect(networks[0]).toMatchObject({ id: 'N1', name: 'Site 1' })
  })

  it('reads the current device-availability endpoint with separate pagination', async () => {
    const requested: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input))
      return new Response(JSON.stringify([
        { serial: 'Q-1', network: { id: 'N1' }, status: 'dormant' },
        { serial: 'Q-2', network: { id: 'N1' }, status: 'offline' },
      ]), { status: 200 })
    }
    const values = await listMerakiOrganizationDeviceAvailabilities({
      environment: 'global', organizationId: 'org-1', credentials, fetchImpl,
    })
    expect(requested).toEqual(['https://api.meraki.com/api/v1/organizations/org-1/devices/availabilities?perPage=1000'])
    expect(values.map((value) => value.status)).toEqual(['dormant', 'offline'])
  })

  it('respects Retry-After for 429 with bounded retry', async () => {
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listMerakiOrganizations({
      environment: 'global',
      credentials,
      fetchImpl,
      requestPolicy: { maxAttempts: 2, sleep },
    })
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry 401/403 and does not expose response bodies or API keys', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ errors: [credentials.apiKey] }), { status }),
      )
      try {
        await listMerakiOrganizations({
          environment: 'global',
          credentials,
          fetchImpl,
          requestPolicy: { maxAttempts: 3, sleep: async () => undefined },
        })
        throw new Error('Expected request to fail.')
      } catch (error) {
        expect(error).toBeInstanceOf(MerakiApiError)
        expect((error as Error).message).not.toContain(credentials.apiKey)
        expect((error as MerakiApiError).status).toBe(status)
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('retries transient 5xx with bounded exponential backoff', async () => {
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listMerakiOrganizations({
      environment: 'global',
      credentials,
      fetchImpl,
      requestPolicy: { maxAttempts: 3, baseDelayMs: 100, sleep },
    })
    expect(sleep).toHaveBeenNthCalledWith(1, 100)
    expect(sleep).toHaveBeenNthCalledWith(2, 200)
  })
})
