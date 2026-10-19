import { beforeEach, describe, expect, it, vi } from 'vitest'
const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
import { withAdmin } from './api-route-guard'

const handler = vi.fn(async (_request: Request) => Response.json({ data: ['synthetic-customer'] }))
const protectedGet = withAdmin(handler)
const request = () => new Request('https://noc.example.test/api/v1/customers')

describe('server-side API authorization', () => {
  beforeEach(() => {
    handler.mockClear()
    getSession.mockReset()
  })

  it('rejects anonymous and expired sessions with 401, without querying data', async () => {
    getSession.mockResolvedValue(null)
    const response = await protectedGet(request())
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects authenticated non-admin users with 403', async () => {
    getSession.mockResolvedValue({ user: { id: 'synthetic-user', role: 'user' } })
    expect((await protectedGet(request())).status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('only invokes handlers for administrators and disables public caching', async () => {
    getSession.mockResolvedValue({ user: { id: 'synthetic-admin', role: 'admin' } })
    const response = await protectedGet(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('fails closed without leaking errors when session lookup fails', async () => {
    getSession.mockRejectedValue(new Error('internal connection detail'))
    const response = await protectedGet(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('internal connection detail')
    expect(handler).not.toHaveBeenCalled()
  })
})
