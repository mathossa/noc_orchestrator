import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  query: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/device-query-store', () => ({ queryDevices: mocks.query }))
vi.mock('@/lib/device-store', () => ({
  createDevice: mocks.create,
  getDevice: mocks.get,
  updateDevice: mocks.update,
  deleteDevice: mocks.remove,
}))

import { GET as list, POST as create } from './route'
import { GET as detail, PATCH as update, DELETE as remove } from './[id]/route'

const url = 'http://localhost/api/v1/devices'
const ctx = { params: Promise.resolve({ id: 'synthetic-device' }) }
function request(method = 'GET') {
  return new Request(url, {
    method,
    ...(method === 'POST' || method === 'PATCH'
      ? { headers: { 'content-type': 'application/json' }, body: '{}' }
      : {}),
  })
}

describe('device API administrator boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.mockResolvedValue({ data: [] })
    mocks.create.mockResolvedValue({ id: 'synthetic-device' })
    mocks.get.mockResolvedValue({ id: 'synthetic-device' })
    mocks.update.mockResolvedValue({ id: 'synthetic-device' })
  })

  it('denies anonymous access before both reads and mutations', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect((await list(request())).status).toBe(401)
    expect((await create(request('POST'))).status).toBe(401)
    expect((await detail(request(), ctx)).status).toBe(401)
    expect((await update(request('PATCH'), ctx)).status).toBe(401)
    expect((await remove(request('DELETE'), ctx)).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('denies authenticated non-administrators with 403', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'reader', role: 'user' } })
    expect((await list(request())).status).toBe(403)
    expect((await create(request('POST'))).status).toBe(403)
    expect((await update(request('PATCH'), ctx)).status).toBe(403)
    expect((await remove(request('DELETE'), ctx)).status).toBe(403)
  })

  it('allows administrator access and supplies the session actor', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin', role: 'admin' } })
    expect((await list(request())).status).toBe(200)
    expect((await create(request('POST'))).status).toBe(201)
    expect((await detail(request(), ctx)).status).toBe(200)
    expect((await update(request('PATCH'), ctx)).status).toBe(200)
    expect((await remove(request('DELETE'), ctx)).status).toBe(204)
    expect(mocks.create).toHaveBeenCalledWith({}, 'admin')
    expect(mocks.update).toHaveBeenCalledWith('synthetic-device', {}, 'admin')
  })
})
