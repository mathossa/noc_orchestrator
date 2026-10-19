import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  rollback: vi.fn(),
}))
vi.mock('@/lib/api-admin', () => ({
  AdminAccessError: class AdminAccessError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
  },
  requireAdminRequest: mocked.requireAdmin,
}))
vi.mock('@/lib/inventory-firmware-repair-store', () => ({
  CanonicalFirmwareRepairError: class CanonicalFirmwareRepairError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
  },
  previewInventoryFirmwareRepairs: mocked.preview,
  applyCanonicalFirmwareRepairs: mocked.apply,
  rollbackCanonicalFirmwareRepair: mocked.rollback,
}))

import { GET } from './route'

const url = 'http://localhost/api/v1/inventory/firmware-links'

describe('#152 inventory firmware link filter API', () => {
  beforeEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset())
    mocked.requireAdmin.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    mocked.preview.mockResolvedValue({ total: 0, rows: [] })
  })

  it('passes the selected software platform all the way to inventory filtering', async () => {
    const response = await GET(new Request(url + '?page=2&linkedPlatform=FortiGate&q=test&vendorId=vendor-1'))
    expect(response.status).toBe(200)
    expect(mocked.preview).toHaveBeenCalledExactlyOnceWith({
      page: 2, q: 'test', vendorId: 'vendor-1', linkedPlatform: 'FortiGate',
    })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('supports FortiOS, AOS-S and unlinked devices without silently dropping the filter', async () => {
    for (const linkedPlatform of ['FortiOS', 'AOS-S', '__UNLINKED__']) {
      const response = await GET(new Request(url + '?linkedPlatform=' + encodeURIComponent(linkedPlatform)))
      expect(response.status).toBe(200)
      expect(mocked.preview).toHaveBeenLastCalledWith({
        page: 1, q: '', vendorId: '', linkedPlatform,
      })
    }
  })

  it('forwards text search without platform and preserves the default all-devices filter', async () => {
    const response = await GET(new Request(url + '?q=branch%20device'))
    expect(response.status).toBe(200)
    expect(mocked.preview).toHaveBeenCalledWith({
      page: 1, q: 'branch device', vendorId: '', linkedPlatform: '',
    })
  })

  it('rejects invalid pagination without running the inventory query', async () => {
    const response = await GET(new Request(url + '?page=-1&linkedPlatform=FortiOS'))
    expect(response.status).toBe(400)
    expect(mocked.preview).not.toHaveBeenCalled()
  })

  it('requires an administrator even for the read-only preview', async () => {
    mocked.requireAdmin.mockRejectedValue(new Error('Access denied'))
    const response = await GET(new Request(url + '?linkedPlatform=FortiOS'))
    expect(response.status).toBe(500)
    expect(mocked.preview).not.toHaveBeenCalled()
  })
})
