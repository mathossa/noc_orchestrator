import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  units: vi.fn(),
  first: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  customer: vi.fn(),
  audit: vi.fn(),
  sites: vi.fn(),
}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    customer: { findUnique: mocks.customer },
    customerOrganizationUnit: {
      findMany: mocks.units,
      findFirst: mocks.first,
      create: mocks.create,
      update: mocks.update,
    },
    auditEvent: { create: mocks.audit },
    site: { findMany: mocks.sites },
    $queryRaw: vi.fn(),
  }
  return {
    prisma: {
      ...tx,
      $transaction: async (fn: (db: unknown) => unknown) => fn(tx),
    },
  }
})
import {
  createOrganizationUnit,
  updateOrganizationUnit,
  listOrganizationUnits,
  getOrganizationUnit,
  deleteOrganizationUnit,
} from './organization-unit-store'
const unit = {
  id: 'east',
  customerId: 'c',
  parentId: null,
  name: 'East',
  code: null,
  notes: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  sourceMetadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  sites: [{ _count: { devices: 2 } }, { _count: { devices: 3 } }],
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.customer.mockResolvedValue({ id: 'c' })
  mocks.units.mockResolvedValue([])
  mocks.create.mockResolvedValue(unit)
  mocks.first.mockResolvedValue(unit)
  mocks.update.mockResolvedValue(unit)
  mocks.sites.mockResolvedValue([])
})
describe('organizational unit canonical CRUD', () => {
  it('supports customers without units and returns counts for multiple units', async () => {
    expect(await listOrganizationUnits('c')).toEqual([])
    mocks.units.mockResolvedValue([
      unit,
      { ...unit, id: 'west', name: 'West', sites: [] },
    ])
    expect(await listOrganizationUnits('c')).toMatchObject([
      { siteCount: 2, deviceCount: 5 },
      { siteCount: 0, deviceCount: 0 },
    ])
    expect(await getOrganizationUnit('c', 'east')).toMatchObject({
      id: 'east',
      sites: [],
      deviceCount: 5,
    })
  })
  it('creates normalized units and records actor and provenance', async () => {
    await createOrganizationUnit(
      'c',
      {
        name: '  East ',
        source: 'IMPORT',
        externalProvider: 'fixture',
        externalId: 'unit-1',
        sourceMetadata: { profile: 'synthetic' },
      },
      'actor',
    )
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'c',
          name: 'East',
          source: 'IMPORT',
          sourceMetadata: { profile: 'synthetic' },
        }),
      }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'actor',
          action: 'ORGANIZATION_UNIT_CREATED',
        }),
      }),
    )
  })
  it('accepts a parent of the same customer', async () => {
    mocks.units.mockResolvedValue([unit])
    await createOrganizationUnit('c', { name: 'Child', parentId: 'east' })
    expect(mocks.create).toHaveBeenCalled()
  })
  it('rejects foreign parents, cycles, and duplicate sibling names', async () => {
    await expect(
      createOrganizationUnit('c', { name: 'Child', parentId: 'foreign' }),
    ).rejects.toThrow('Parent unit must belong')
    mocks.units.mockResolvedValue([
      unit,
      { ...unit, id: 'child', parentId: 'east', name: 'Child' },
    ])
    await expect(
      updateOrganizationUnit('c', 'east', { parentId: 'child' }),
    ).rejects.toThrow('own ancestor')
    await expect(
      createOrganizationUnit('c', { name: ' EAST ' }),
    ).rejects.toThrow('already exists')
  })
  it('protects manually owned data from imported updates and customer moves', async () => {
    await expect(
      updateOrganizationUnit('c', 'east', {
        name: 'Changed',
        source: 'IMPORT',
      }),
    ).rejects.toThrow('Manually owned')
    await expect(
      updateOrganizationUnit('c', 'east', { customerId: 'other' }),
    ).rejects.toThrow('across customers')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('deactivates referenced units, preserves provenance, and rejects deletion', async () => {
    await updateOrganizationUnit('c', 'east', { isActive: false })
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          source: 'MANUAL',
          name: 'East',
        }),
      }),
    )
    await expect(deleteOrganizationUnit('c', 'east')).rejects.toThrow(
      'Deactivate',
    )
  })
})
