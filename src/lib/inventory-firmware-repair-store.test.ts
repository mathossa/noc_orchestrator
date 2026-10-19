import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  deviceCount: vi.fn(),
  deviceFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
  releaseFindMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: { count: db.deviceCount, findMany: db.deviceFindMany },
    vendor: { findMany: db.vendorFindMany },
    firmwareRelease: { findMany: db.releaseFindMany },
  },
}))

import { previewInventoryFirmwareRepairs } from '@/lib/inventory-firmware-repair-store'

describe('#152 inventory correction query scope', () => {
  beforeEach(() => {
    Object.values(db).forEach((fn) => fn.mockReset())
    db.deviceCount.mockResolvedValue(0)
    db.deviceFindMany.mockResolvedValue([])
    db.vendorFindMany.mockResolvedValue([])
    db.releaseFindMany.mockResolvedValue([])
  })

  it('filters current canonical platform in the database rather than just the UI', async () => {
    await previewInventoryFirmwareRepairs({ linkedPlatform: 'FortiGate' })
    expect(db.deviceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        currentFirmwareRelease: {
          is: { platform: { equals: 'FortiGate', mode: 'insensitive' } },
        },
      },
      take: 50,
      skip: 0,
    }))
    expect(db.deviceCount).toHaveBeenCalledWith({
      where: {
        currentFirmwareRelease: {
          is: { platform: { equals: 'FortiGate', mode: 'insensitive' } },
        },
      },
    })
  })

  it('combines platform, vendor and search text as server-side filters', async () => {
    await previewInventoryFirmwareRepairs({
      page: 2, q: 'example switch', vendorId: 'vendor-123', linkedPlatform: 'AOS-S',
    })
    const filter = db.deviceFindMany.mock.calls[0][0]
    expect(filter.skip).toBe(50)
    expect(filter.where.deviceModel).toEqual({ vendorId: 'vendor-123' })
    expect(filter.where.currentFirmwareRelease.is.platform.equals).toBe('AOS-S')
    expect(filter.where.OR).toEqual(expect.arrayContaining([
      { name: { contains: 'example switch', mode: 'insensitive' } },
      { customer: { name: { contains: 'example switch', mode: 'insensitive' } } },
    ]))
  })

  it('finds unlinked device references and does not leak the previous platform', async () => {
    await previewInventoryFirmwareRepairs({ linkedPlatform: '__UNLINKED__' })
    expect(db.deviceFindMany.mock.calls[0][0].where).toEqual({ currentFirmwareReleaseId: null })
    await previewInventoryFirmwareRepairs()
    expect(db.deviceFindMany.mock.calls[1][0].where).toEqual({})
  })
})
