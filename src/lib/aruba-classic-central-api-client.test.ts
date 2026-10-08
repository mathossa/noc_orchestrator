import { describe, expect, it, vi } from 'vitest'
import { arubaCentralApiBaseUrl, ArubaCentralApiError } from '@/lib/aruba-central-api-client'
import {
  listClassicCentralDevices,
  listClassicCentralSites,
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

  it('returns an empty site catalog without fabricating a site or group',async()=>{
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({count:0,total:0,sites:[]}))
    await expect(listClassicCentralSites({
      configuration,accessToken:'TEST_ACCESS',fetchImpl,
    })).resolves.toEqual([])
  })

  it('preserves numeric Aruba site IDs and uses the documented Central response shape',async()=>{
    const fetchImpl: typeof fetch = async (url) => {
      const location=new URL(String(url))
      expect(location.pathname).toBe('/central/v2/sites')
      expect(location.searchParams.get('offset')).toBe('0')
      return new Response(JSON.stringify({
        count:2,total:2,
        sites:[{site_id:12,site_name:'HQ'},{site_id:38,site_name:'Branch'}],
      }))
    }
    await expect(listClassicCentralSites({
      configuration,accessToken:'TEST_ACCESS',fetchImpl,
    })).resolves.toEqual([{id:'12',name:'HQ'},{id:'38',name:'Branch'}])
  })

  it('keeps Classic AOS-S switches when the gateway endpoint responds with mcs', async () => {
    const fetchImpl: typeof fetch = async (request) => {
      const url = new URL(String(request))
      if (url.pathname.endsWith('/aps')) return new Response(JSON.stringify({aps:[]}))
      if (url.pathname.endsWith('/switches')) {
        expect(url.searchParams.get('fields')).toContain('site')
        return new Response(JSON.stringify({
          count:1,
          switches:[{
            serial:'CN90HKZ1DM',name:'SiteA-Gateway-SW',
            switch_type:'AOS-S',site:'HQ',site_id:155,
            model:'Aruba2930F-8G-PoE+-2SFP+ Switch(JL258A)',
            firmware_version:'16.10.0017',
            status:'Up',
          }],
        }))
      }
      return new Response(JSON.stringify({count:0,mcs:[]}))
    }
    const devices=await listClassicCentralDevices({
      configuration,accessToken:'TEST_ACCESS',fetchImpl,
    })
    expect(devices).toEqual([{
      kind:'SWITCH',
      raw:expect.objectContaining({
        serial:'CN90HKZ1DM',site:'HQ',site_id:155,
        firmware_version:'16.10.0017',
      }),
    }])
  })

})
