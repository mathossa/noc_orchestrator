import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))

import { proxy, config } from './proxy'

const req = (path: string) => new NextRequest('http://localhost:3000' + path)

describe('central authentication boundary', () => {
  beforeEach(() => getSession.mockReset())

  it('allows the public health check without looking up a session', async () => {
    const response = await proxy(req('/api/v1/health'))
    expect(response.status).toBe(200)
    expect(getSession).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated inventory API reads and writes', async () => {
    getSession.mockResolvedValue(null)
    for (const path of ['/api/v1/customers', '/api/v1/devices', '/api/v1/device-import-v2/batches']) {
      const response = await proxy(req(path))
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('redirects unauthenticated app pages to sign-in', async () => {
    getSession.mockResolvedValue(null)
    const response = await proxy(req('/customers'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/sign-in')
  })

  it('rejects signed-in non-admins', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1', role: 'user' } })
    expect((await proxy(req('/api/v1/customers'))).status).toBe(403)
    const response = await proxy(req('/devices'))
    expect(response.headers.get('location')).toContain('/sign-in?error=forbidden')
  })

  it('lets an administrator access the app without public caching', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const response = await proxy(req('/devices'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('matches both API and rendered inventory paths', () => {
    expect(config.matcher).toContain('/api/v1/:path*')
    expect(config.matcher.some((pattern) => pattern.includes('_next/'))).toBe(true)
  })
})
