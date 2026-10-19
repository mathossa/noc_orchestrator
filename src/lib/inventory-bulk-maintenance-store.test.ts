import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  devices: vi.fn(), customer: vi.fn(), site: vi.fn(), model: vi.fn(),
  deviceUpdateMany: vi.fn(), deviceFindUnique: vi.fn(), auditCreate: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => {
  const device = {
    findMany: mocks.devices,
    updateMany: mocks.deviceUpdateMany,
    findUniqueOrThrow: mocks.deviceFindUnique,
  }
  const client = {
    device,
    customer: { findUnique: mocks.customer },
    site: { findUnique: mocks.site },
    deviceModel: { findUnique: mocks.model },
    auditEvent: { create: mocks.auditCreate },
  }
  return {
    prisma: {
      ...client,
      $transaction: mocks.transaction,
    },
  }
})
import {
  previewInventoryBulkMaintenance,
  applyInventoryBulkMaintenance,
} from '@/lib/inventory-bulk-maintenance-store'

const device = (id: string, update: Record<string, unknown> = {}) => ({
  id,
  name: 'SW-' + id,
  customerId: 'customer-old',
  siteId: 'site-old',
  deviceModelId: 'model-old',
  isActive: true,
  updatedAt: new Date('2026-01-01T12:00:00.000Z'),
  customer: { name: 'Original customer' },
  site: { name: 'Original site' },
  deviceModel: { model: 'Switch-24', vendorId: 'vendor' },
  currentFirmwareRelease: { vendorId: 'vendor', platform: 'AOS-S' },
  ...update,
})
const items = (ids: string[]) => ids.map((id) => ({
  deviceId: id, updatedAt: '2026-01-01T12:00:00.000Z',
}))

describe('#112 safe recorded inventory bulk changes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset())
    mocks.devices.mockResolvedValue([device('a'), device('b')])
    mocks.customer.mockResolvedValue({ id: 'customer-new', name: 'Other customer', isActive: true })
    mocks.site.mockResolvedValue({ id: 'site-new', name: 'Other site', customerId: 'customer-old', isActive: true })
    mocks.model.mockResolvedValue({
      id: 'model-new', model: 'Switch-48', vendorId: 'vendor', platform: 'AOS-S', isActive: true,
    })
    mocks.deviceUpdateMany.mockResolvedValue({ count: 1 })
    mocks.deviceFindUnique.mockResolvedValue({
      customerId: 'customer-old', siteId: 'site-old',
      deviceModelId: 'model-old', isActive: false,
    })
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (fn) => fn({
      device: {
        findMany: mocks.devices, updateMany: mocks.deviceUpdateMany,
        findUniqueOrThrow: mocks.deviceFindUnique,
      },
      customer: { findUnique: mocks.customer },
      site: { findUnique: mocks.site },
      deviceModel: { findUnique: mocks.model },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('previews archive of two devices without modifying database', async () => {
    const plan = await previewInventoryBulkMaintenance({ operation: 'ARCHIVE', items: items(['a', 'b']) })
    expect(plan.changedCount).toBe(2)
    expect(plan.items.map((i) => i.after)).toEqual(['Archived', 'Archived'])
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('allows a manual change even when a device firmware link is already valid', async () => {
    const plan = await previewInventoryBulkMaintenance({
      operation: 'SET_SITE', targetId: 'site-new', items: items(['a', 'b']),
    })
    expect(plan.changedCount).toBe(2)
  })

  it('rejects cross-customer site assignment atomically before any writes', async () => {
    mocks.site.mockResolvedValue({ id: 'site-new', name: 'Third-party site', customerId: 'other', isActive: true })
    await expect(previewInventoryBulkMaintenance({
      operation: 'SET_SITE', targetId: 'site-new', items: items(['a', 'b']),
    })).rejects.toThrow('belong to the customer')
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects a customer move that causes a normalized-name collision', async () => {
    mocks.devices
      .mockResolvedValueOnce([device('a'), device('b')])
      .mockResolvedValueOnce([{ id: 'outside', name: 'sw-a' }])
    await expect(previewInventoryBulkMaintenance({
      operation: 'SET_CUSTOMER', targetId: 'customer-new', items: items(['a', 'b']),
    })).rejects.toThrow('same normalized name')
  })

  it('previews clearing old site during a customer move', async () => {
    mocks.devices.mockResolvedValueOnce([device('a'), device('b')]).mockResolvedValueOnce([])
    const plan = await previewInventoryBulkMaintenance({
      operation: 'SET_CUSTOMER', targetId: 'customer-new', items: items(['a', 'b']),
    })
    expect(plan.changedCount).toBe(2)
    expect(plan.items[0].note).toContain('site will be cleared')
  })

  it('prevents a model change that would invalidate the linked firmware', async () => {
    mocks.model.mockResolvedValue({ id: 'model-new', model: 'Different device', vendorId: 'vendor', platform: 'FortiOS', isActive: true })
    await expect(previewInventoryBulkMaintenance({
      operation: 'SET_MODEL', targetId: 'model-new', items: items(['a', 'b']),
    })).rejects.toThrow('incompatible')
  })

  it('rejects stale selection before committing anything', async () => {
    mocks.devices.mockResolvedValue([device('a', { updatedAt: new Date('2026-01-02T12:00:00Z') }), device('b')])
    await expect(previewInventoryBulkMaintenance({
      operation: 'ACTIVATE', items: items(['a', 'b']),
    })).rejects.toThrow('changed')
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalled()
  })

  it('commits only after preview fingerprint and creates audit entries', async () => {
    const input = { operation: 'ARCHIVE', items: items(['a', 'b']) } as const
    const plan = await previewInventoryBulkMaintenance(input)
    const result = await applyInventoryBulkMaintenance({
      ...input, action: 'apply', confirmed: true, fingerprint: plan.fingerprint,
    }, 'actor-test')
    expect(result.updated).toBe(2)
    expect(mocks.deviceUpdateMany).toHaveBeenCalledTimes(2)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2)
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'INVENTORY_BULK_ARCHIVE', actorUserId: 'actor-test' }),
    }))
  })

  it('refuses a different or stale confirmation fingerprint', async () => {
    await expect(applyInventoryBulkMaintenance({
      operation: 'ARCHIVE', items: items(['a','b']), confirmed: true,
      fingerprint: 'f'.repeat(64),
    }, 'actor-test')).rejects.toThrow('stale')
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects selections above the 50-row limit', async () => {
    await expect(previewInventoryBulkMaintenance({
      operation: 'ARCHIVE',
      items: items(Array.from({ length: 51 }, (_, index) => 'device-' + index)),
    })).rejects.toThrow('1–50')
  })
})
