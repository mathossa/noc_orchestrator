import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))

import { proxy, config } from './proxy'

const req = (path: string, method = 'GET') =>
  new NextRequest('http://localhost:3000' + path, { method })

describe('central authentication boundary', () => {
  beforeEach(() => getSession.mockReset())

  it('keeps health and Better Auth available without a session lookup', async () => {
    for (const path of ['/api/v1/health', '/api/auth/get-session', '/sign-in']) {
      expect((await proxy(req(path))).status).toBe(200)
    }
    expect(getSession).not.toHaveBeenCalled()
  })

  it('rejects anonymous protected API reads and mutations', async () => {
    getSession.mockResolvedValue(null)
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const response = await proxy(req('/api/v1/devices', method))
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect((await proxy(req('/api/v1/reports/inventory/xlsx'))).status).toBe(401)
  })

  it('rejects authenticated non-admin users', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1', role: 'user' } })
    expect((await proxy(req('/api/v1/customers'))).status).toBe(403)
    const response = await proxy(req('/devices'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in?error=forbidden')
  })

  it('redirects anonymous pages to login with a local return path', async () => {
    getSession.mockResolvedValue(null)
    const response = await proxy(req('/customers?active=true'))
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).searchParams.get('next'))
      .toBe('/customers?active=true')
  })

  it('does not cache protected administrator responses', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const response = await proxy(req('/devices'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('fails closed if session resolution throws', async () => {
    getSession.mockRejectedValue(new Error('synthetic database error'))
    const response = await proxy(req('/api/v1/customers'))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('synthetic database error')
  })

  it('does not exclude dotted API paths or arbitrary static-looking app URLs', () => {
    expect(config.matcher).toHaveLength(1)
    expect(config.matcher[0]).not.toContain('.*\\\\..*')
    expect(config.matcher[0]).not.toContain('(?!api/')
    expect(config.matcher[0]).toContain('_next/static')
  })
})
