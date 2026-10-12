import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  customers: vi.fn(),
  devices: vi.fn(),
  identity: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2WorkspaceBatch: { findUnique: mocks.batch },
    customer: { findMany: mocks.customers },
    device: { findMany: mocks.devices },
  },
}))
vi.mock('@/lib/importer-v2-workspace-effective-overlay', () => ({
  importerV2WorkspaceEffectiveEvaluated: ({ evaluated }: { evaluated: unknown }) =>
    ({ evaluated }),
  importerV2WorkspaceEffectiveText: (value: {
    rawValues?: Record<string, string | null>
    proposedCanonicalValues?: Record<string, { id?: string | null; label?: string | null } | null>
  }, field: string) => value.proposedCanonicalValues?.[field]?.label ?? value.rawValues?.[field] ?? null,
}))
vi.mock('@/lib/importer-v2-workspace-identity-state', () => ({
  importerV2WorkspaceIdentityReview: mocks.identity,
}))

import { findImporterV2PublicationNameConflicts } from '@/lib/importer-v2-publication-name-conflicts'

function row(rowNumber: number, deviceName: string, customer: string) {
  return {
    rowNumber, inclusion: 'INCLUDED', publishedAt: null,
    identityResolution: {}, decisions: [],
    evaluated: {
      rawValues: { deviceName, customer },
      proposedCanonicalValues: { customer: { id: 'customer-1', label: customer } },
    },
  }
}

describe('Importer v2 canonical customer/name publication guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batch.mockResolvedValue({
      rows: [row(1,'AP01','Customer A'),row(2,'SW01','Customer A'),row(3,'SW02','Customer A')],
    })
    mocks.identity.mockReturnValue({
      selectedDecision: 'CREATE_NEW', selectedCanonicalDeviceId: null,
      candidates: [], requiresConfirmation: false,
    })
    mocks.customers.mockResolvedValue([{id:'customer-1',name:'Customer A'}])
    mocks.devices.mockResolvedValue([{customerId:'customer-1',name:'SW01'}])
  })

  it('blocks only the conflicting name without merging unrelated devices', async () => {
    await expect(findImporterV2PublicationNameConflicts({
      batchId:'batch-1',rowNumbers:[1,2,3],
    })).resolves.toEqual([2])
    expect(mocks.devices).toHaveBeenCalledWith(expect.objectContaining({
      where:expect.objectContaining({name:{in:['AP01','SW01','SW02']}}),
    }))
  })

  it('blocks both newly created rows when their names clash with each other', async () => {
    mocks.devices.mockResolvedValue([])
    mocks.batch.mockResolvedValue({rows:[
      row(1,'SW01','Customer A'),row(2,'SW01','Customer A'),row(3,'AP01','Customer A'),
    ]})
    await expect(findImporterV2PublicationNameConflicts({
      batchId:'batch-1',rowNumbers:[1,2,3],
    })).resolves.toEqual([1,2])
  })

  it('does not block an existing canonical update because its name already exists', async () => {
    mocks.batch.mockResolvedValue({rows:[row(1,'SW01','Customer A')]})
    mocks.identity.mockReturnValue({
      selectedDecision:'LINK_EXISTING',selectedCanonicalDeviceId:'device-existing',
      candidates:[],requiresConfirmation:false,
    })
    await expect(findImporterV2PublicationNameConflicts({
      batchId:'batch-1',rowNumbers:[1],
    })).resolves.toEqual([])
    expect(mocks.devices).not.toHaveBeenCalled()
  })

  it('does not use matching names as proof that two serial identities match', async () => {
    await findImporterV2PublicationNameConflicts({batchId:'batch-1',rowNumbers:[1,2,3]})
    expect(mocks.identity).toHaveBeenCalledTimes(3)
    expect(mocks.devices).toHaveBeenCalledTimes(1)
  })
})
