import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  AuvikApiError,
  AuvikRegionRedirectError,
  listAuvikDevicesV2,
} from '@/lib/auvik-api-client'

const credentials = {
  username: 'DUMMY_AUVIK_USER',
  apiKey: 'DUMMY_AUVIK_KEY',
}

describe('Auvik Device API v2 client', () => {
  it('uses tenant scoping, JSON:API accept, basic auth, and the v2 page size', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(
        JSON.stringify({
          data: [
            {
              type: 'device',
              id: 'device-1',
              attributes: {
                deviceName: 'SW01',
                make: 'Cisco',
                model: 'C9300-24P',
                deviceTypeDescription: 'Switch',
              },
            },
          ],
        }),
        { status: 200 },
      )
    }

    const devices = await listAuvikDevicesV2({
      region: 'EU1',
      tenantId: 'tenant-123',
      credentials,
      fetchImpl,
    })

    expect(devices).toHaveLength(1)
    expect(calls).toHaveLength(1)

    const requestUrl = new URL(calls[0].url)
    expect(requestUrl.origin).toBe('https://auvikapi.eu1.my.auvik.com')
    expect(requestUrl.pathname).toBe('/v2/api/inventory/device/info')
    expect(requestUrl.searchParams.get('tenant')).toBe('tenant-123')
    expect(requestUrl.searchParams.get('page[first]')).toBe('1000')

    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('Accept')).toBe('application/vnd.api+json')
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from(
        `${credentials.username}:${credentials.apiKey}`,
        'utf8',
      ).toString('base64')}`,
    )
    expect(calls[0].init?.redirect).toBe('manual')
  })

  it('follows same-host JSON:API pagination links', async () => {
    const requested: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input))

      if (requested.length === 1) {
        return new Response(
          JSON.stringify({
            data: [
              {
                type: 'device',
                id: 'device-1',
                attributes: { deviceName: 'SW01' },
              },
            ],
            links: {
              next: 'https://auvikapi.eu1.my.auvik.com/v2/api/inventory/device/info?tenant=tenant-123&page%5Bafter%5D=cursor-1',
            },
          }),
          { status: 200 },
        )
      }

      return new Response(
        JSON.stringify({
          data: [
            {
              type: 'device',
              id: 'device-2',
              attributes: { deviceName: 'SW02' },
            },
          ],
          links: { next: null },
        }),
        { status: 200 },
      )
    }

    const devices = await listAuvikDevicesV2({
      region: 'eu1',
      tenantId: 'tenant-123',
      credentials,
      fetchImpl,
    })

    expect(devices.map((device) => device.id)).toEqual(['device-1', 'device-2'])
    expect(requested).toHaveLength(2)
    expect(requested[1]).toContain('page%5Bafter%5D=cursor-1')
  })

  it('surfaces a region move without following it automatically', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 308,
        headers: {
          Location:
            'https://auvikapi.eu2.my.auvik.com/v2/api/inventory/device/info',
        },
      })

    await expect(
      listAuvikDevicesV2({
        region: 'eu1',
        tenantId: 'tenant-123',
        credentials,
        fetchImpl,
      }),
    ).rejects.toMatchObject<AuvikRegionRedirectError>({
      name: 'AuvikRegionRedirectError',
      status: 308,
      location: 'https://auvikapi.eu2.my.auvik.com/v2/api/inventory/device/info',
    })
  })

  it('classifies rate-limit and server failures as retryable without leaking credentials', async () => {
    for (const status of [429, 500]) {
      const fetchImpl: typeof fetch = async () =>
        new Response(JSON.stringify({ errors: [{ detail: 'provider detail' }] }), {
          status,
        })

      try {
        await listAuvikDevicesV2({
          region: 'eu1',
          tenantId: 'tenant-123',
          credentials,
          fetchImpl,
        })
        throw new Error('Expected the Auvik request to fail.')
      } catch (error) {
        expect(error).toBeInstanceOf(AuvikApiError)
        expect(error).toMatchObject({ status, retryable: true })
        expect((error as Error).message).not.toContain(credentials.apiKey)
        expect((error as Error).message).not.toContain(credentials.username)
        expect((error as Error).message).not.toContain('provider detail')
      }
    }
  })

  it('rejects pagination URLs outside the configured Auvik host', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: [],
          links: { next: 'https://example.com/unexpected-page' },
        }),
        { status: 200 },
      )

    await expect(
      listAuvikDevicesV2({
        region: 'eu1',
        tenantId: 'tenant-123',
        credentials,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: 'AuvikApiError',
      status: 502,
      retryable: false,
    })
  })
})
