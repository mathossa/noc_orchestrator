import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getQa: vi.fn(),
  publish: vi.fn(),
  findIdentityConflicts: vi.fn(),
}))

vi.mock('@/lib/importer-v2-publication-store', () => {
  class ImporterV2PublicationConflictError extends Error {}
  class ImporterV2PublicationValidationError extends Error {}
  return {
    getImporterV2PublicationQa: mocks.getQa,
    publishImporterV2Batch: mocks.publish,
    ImporterV2PublicationConflictError,
    ImporterV2PublicationValidationError,
  }
})

vi.mock('@/lib/importer-v2-publication-identity-diagnostics', () => ({
  findImporterV2PublicationIdentityConflicts: mocks.findIdentityConflicts,
}))

import { autoPublishImporterV2SafeValidRows } from '@/lib/importer-v2-auto-publication'

function qa(overrides: Record<string, unknown> = {}) {
  return {
    qaFingerprint: 'qa-1',
    counts: {
      pending: 4,
    },
    catalogProposals: [],
    identityConflicts: [],
    firmware: {
      unknownFirmwareRows: [],
      platformConflictRows: [],
    },
    publication: {
      validOnlyCandidateRows: [1, 2, 3],
      allResolvedCandidateRows: [1, 2, 3],
      unresolvedRows: [{ rowNumber: 4, reasons: ['Review required.'] }],
      excludedRows: [],
    },
    ...overrides,
  }
}

describe('Importer v2 safe automatic publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getQa.mockResolvedValue(qa())
    mocks.findIdentityConflicts.mockResolvedValue([])
    mocks.publish.mockResolvedValue({
      publishedLogicalDeviceCount: 3,
      publishedRowCount: 3,
      remainingIncludedRows: 1,
    })
  })

  it('publishes only already-valid rows and leaves review rows staged', async () => {
    const result = await autoPublishImporterV2SafeValidRows('batch-1')

    expect(mocks.findIdentityConflicts).toHaveBeenCalledWith({
      batchId: 'batch-1',
      rowNumbers: [1, 2, 3, 4],
    })
    expect(mocks.publish).toHaveBeenCalledWith({
      batchId: 'batch-1',
      mode: 'VALID_ONLY',
      qaFingerprint: 'qa-1',
      idempotencyKey: 'AUTO_VALID:qa-1',
      approvedProposalKeys: [],
      rowNumbers: [1, 2, 3],
      actorUserId: null,
    })
    expect(result).toMatchObject({
      status: 'PUBLISHED',
      publishedLogicalDeviceCount: 3,
      remainingIncludedRows: 1,
      reconciliationRequired: true,
    })
  })

  it('does not auto-approve new canonical catalog data', async () => {
    mocks.getQa.mockResolvedValue(
      qa({
        catalogProposals: [
          {
            key: 'new-model',
            field: 'model',
            label: 'New model',
            context: { vendor: 'vendor-1' },
            rowNumbers: [2],
          },
        ],
      }),
    )
    mocks.publish.mockResolvedValue({
      publishedLogicalDeviceCount: 2,
      publishedRowCount: 2,
      remainingIncludedRows: 2,
    })

    const result = await autoPublishImporterV2SafeValidRows('batch-1')

    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedProposalKeys: [],
        rowNumbers: [1, 3],
      }),
    )
    expect(result.blockedRowNumbers).toContain(2)
  })

  it('keeps both sides of a staged durable-identity collision for review', async () => {
    mocks.findIdentityConflicts.mockResolvedValue([
      {
        rowNumber: 1,
        stagedConflicts: [{ rowNumber: 4 }],
      },
    ])
    mocks.publish.mockResolvedValue({
      publishedLogicalDeviceCount: 2,
      publishedRowCount: 2,
      remainingIncludedRows: 2,
    })

    const result = await autoPublishImporterV2SafeValidRows('batch-1')

    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        rowNumbers: [2, 3],
      }),
    )
    expect(result.blockedRowNumbers).toEqual([1, 4])
  })
})
