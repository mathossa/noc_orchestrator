import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE } from '@/lib/importer-v2-hierarchy'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2SourceProfile: {
      findMany: mocks.findMany,
      create: mocks.create,
      update: mocks.update,
    },
  },
}))

import {
  createImporterV2SourceProfile,
  listActiveImporterV2SourceProfiles,
  updateImporterV2SourceProfile,
} from '@/lib/importer-v2-source-profile-store'

const input = {
  id: 'profile-1',
  name: 'Synthetic inventory',
  version: '1',
  isActive: true,
  provider: 'SyntheticCMDB',
  sourceAdapterId: 'xlsx-tabular-v1',
  sheetName: 'Inventory',
  headerRow: 1,
  headers: ['Organization', 'Device ID'],
  columnMappings: [
    {
      columnIndex: 0,
      sourceHeader: 'Organization',
      targetField: 'customer' as const,
    },
    {
      columnIndex: 1,
      sourceHeader: 'Device ID',
      targetField: 'sourceId' as const,
    },
  ],
  hierarchyTemplate: IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
  deviceTypePolicy: {
    version: '1',
    defaultAction: 'INCLUDE' as const,
    rules: [],
  },
  defaults: {},
  exactValueAliases: [],
}

describe('Importer v2 source-profile persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists the confirmed profile and its derived schema fingerprint', async () => {
    mocks.create.mockImplementation(async ({ data }) => data)

    const created = await createImporterV2SourceProfile(input)

    expect(created.schemaFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'profile-1',
        provider: 'SyntheticCMDB',
        hierarchyTemplate: expect.objectContaining({
          id: 'customer-business-unit-site',
        }),
        deviceTypePolicy: expect.objectContaining({ defaultAction: 'INCLUDE' }),
      }),
    })
  })

  it('loads active profiles in a stable order for recognition', async () => {
    mocks.findMany.mockResolvedValue([
      { ...input, schemaFingerprint: 'fingerprint' },
    ])

    const profiles = await listActiveImporterV2SourceProfiles()

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    expect(profiles).toEqual([{ ...input, schemaFingerprint: 'fingerprint' }])
  })

  it('recomputes the fingerprint when a saved mapping is updated', async () => {
    mocks.update.mockImplementation(async ({ data }) => ({
      id: input.id,
      ...data,
    }))
    const { id, ...update } = input

    const result = await updateImporterV2SourceProfile(id, {
      ...update,
      sheetName: 'Updated export',
    })

    expect(result.schemaFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({
        sheetName: 'Updated export',
        schemaFingerprint: result.schemaFingerprint,
      }),
    })
  })
})
