import { describe, expect, it, vi } from 'vitest'
import { arubaCentralApiBaseUrl, ArubaCentralApiError } from '@/lib/aruba-central-api-client'
import {
  listClassicCentralDevices,
  refreshClassicCentralAccessToken,
} from '@/lib/aruba-classic-central-api-client'

const configuration = { variant: 'CLASSIC' as const, baseUrl: 'https://eu-apigw.central.arubanetworks.com' }
const credentials = { clientId: 'TEST_CLIENT', clientSecret: 'TEST_SECRET' }

describe('Aruba Classic Central client', () => {
  it('accepts Classic regional gateways but rejects New Central gateways', () => {
    expect(arubaCentralApiBaseUrl(configuration).hostname).toBe('eu-apigw.central.arubanetworks.com')
    expect(() => arubaCentralApiBaseUrl({ variant: 'CLASSIC', baseUrl: 'https://de1.api.central.arubanetworks.com' })).toThrow()
    expect(() => arubaCentralApiBaseUrl({ variant: 'CLASSIC', baseUrl: 'https://eu-apigw.central.arubanetworks.com.bad.invalid' })).toThrow()
  })

  it('refreshes credentials on the Classic gateway', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ access_token: 'A2', refresh_token: 'R2' })))
    const tokens = await refreshClassicCentralAccessToken({ configuration, credentials, refreshToken: 'R1', fetchImpl })
    expect(tokens).toEqual({ accessToken: 'A2', refreshToken: 'R2' })
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.pathname).toBe('/oauth2/token')
    expect(url.searchParams.get('grant_type')).toBe('refresh_token')
  })

  it('retrieves separate AP, switch and gateway collections with offline evidence', async () => {
    const requested: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      requested.push(url.pathname)
      if (url.pathname.endsWith('/aps')) return new Response(JSON.stringify({ aps: [{serial:'AP1',status:'Down'}] }))
      if (url.pathname.endsWith('/switches')) return new Response(JSON.stringify({ switches: [{serial:'SW1',status:'Up'}] }))
      return new Response(JSON.stringify({ gateways: [{serial:'GW1',status:'Down'}] }))
    }
    const result = await listClassicCentralDevices({ configuration, accessToken: 'A1', fetchImpl })
    expect(result.map(row => [row.kind,row.raw.serial,row.raw.status])).toEqual([
      ['AP','AP1','Down'],['SWITCH','SW1','Up'],['GATEWAY','GW1','Down'],
    ])
    expect(requested).toEqual(['/monitoring/v2/aps','/monitoring/v1/switches','/monitoring/v1/gateways'])
  })

  it('persists a rotated refresh token before resuming after 401', async () => {
    const order: string[] = []
    let first = true
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/oauth2/token') return new Response(JSON.stringify({access_token:'A2',refresh_token:'R2'}))
      if (first) { first = false; return new Response(null, {status:401}) }
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer A2')
      expect(order).toEqual(['persisted'])
      const collection = url.pathname.endsWith('/aps') ? 'aps' : url.pathname.endsWith('/switches') ? 'switches' : 'gateways'
      return new Response(JSON.stringify({[collection]:[]}))
    }
    const persist = vi.fn(async () => { order.push('persisted') })
    await listClassicCentralDevices({
      configuration, accessToken: 'A1', fetchImpl,
      refresh: { credentials, refreshToken:'R1', onTokensRotated: persist },
    })
    expect(persist).toHaveBeenCalledWith({accessToken:'A2',refreshToken:'R2'})
  })

  it('fails the entire fetch if any API collection is malformed', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      return new Response(JSON.stringify(url.pathname.endsWith('/aps') ? {aps:[{serial:'AP1'}]} : {}))
    }
    await expect(listClassicCentralDevices({configuration,accessToken:'A1',fetchImpl}))
      .rejects.toBeInstanceOf(ArubaCentralApiError)
  })
})
