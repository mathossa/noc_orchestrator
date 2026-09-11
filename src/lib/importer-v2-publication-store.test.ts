import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  attemptFindUnique: vi.fn(),
  transaction: vi.fn(),
  txAttemptFindUnique: vi.fn(),
  batchFindUnique: vi.fn(),
  attemptCreate: vi.fn(),
  deviceUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2PublicationAttempt: { findUnique: mocks.attemptFindUnique },
    $transaction: mocks.transaction,
  },
}))

import {
  ImporterV2PublicationConflictError,
  publishImporterV2Batch,
} from '@/lib/importer-v2-publication-store'

describe('Importer v2 publication persistence boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.attemptFindUnique.mockResolvedValue(null)
  })

  it('returns the previously committed result for an idempotent retry without opening a new transaction', async () => {
    const result = {
      publicationAttemptId: 'attempt-1',
      batchId: 'batch-1',
      publishedRows: [
        { rowNumber: 2, canonicalDeviceId: 'device-1', action: 'UPDATE' },
      ],
    }
    mocks.attemptFindUnique.mockResolvedValue({
      id: 'attempt-1',
      status: 'SUCCEEDED',
      result,
    })

    await expect(
      publishImporterV2Batch({
        batchId: 'batch-1',
        mode: 'ALL_RESOLVED',
        qaFingerprint: 'qa-1',
        idempotencyKey: 'same-request',
        approvedProposalKeys: [],
      }),
    ).resolves.toEqual(result)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('surfaces a failed transactional write and does not manufacture a successful retry record', async () => {
    mocks.transaction.mockRejectedValue(new Error('required device write failed'))

    await expect(
      publishImporterV2Batch({
        batchId: 'batch-1',
        mode: 'VALID_ONLY',
        qaFingerprint: 'qa-1',
        idempotencyKey: 'failed-request',
        approvedProposalKeys: [],
      }),
    ).rejects.toThrow('required device write failed')
    expect(mocks.attemptFindUnique).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale QA fingerprint inside the transaction before canonical writes begin', async () => {
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          importerV2PublicationAttempt: {
            findUnique: mocks.txAttemptFindUnique.mockResolvedValue(null),
            create: mocks.attemptCreate,
          },
          importerV2WorkspaceBatch: {
            findUnique: mocks.batchFindUnique.mockResolvedValue({
              id: 'batch-1',
              name: 'devices.xlsx',
              provider: 'Auvik',
              sourceAdapterId: 'xlsx-v1',
              profileId: 'profile-1',
              profileVersion: '2',
              evaluationFingerprint: 'evaluation-1',
              status: 'RECONCILING',
              rowCount: 1,
              publishedRowCount: 0,
              rows: [
                {
                  id: 'row-1',
                  rowNumber: 2,
                  sourceFingerprint: 'row-fingerprint',
                  inclusion: 'INCLUDED',
                  statuses: ['VALID'],
                  primaryStatus: 'VALID',
                  repeatClassification: 'NEW',
                  needsReevaluation: false,
                  reviewRevision: 4,
                  publishedAt: null,
                  publicationAttemptId: null,
                  firmwareEvidencePattern: null,
                  evaluated: {
                    rawValues: {},
                    proposedCanonicalValues: {},
                    issues: [],
                  },
                  identityResolution: null,
                  repeatDiff: null,
                  decisions: [],
                },
              ],
            }),
          },
          device: { update: mocks.deviceUpdate },
        }),
    )

    await expect(
      publishImporterV2Batch({
        batchId: 'batch-1',
        mode: 'VALID_ONLY',
        qaFingerprint: 'stale-qa-fingerprint',
        idempotencyKey: 'stale-request',
        approvedProposalKeys: [],
      }),
    ).rejects.toBeInstanceOf(ImporterV2PublicationConflictError)
    expect(mocks.attemptCreate).not.toHaveBeenCalled()
    expect(mocks.deviceUpdate).not.toHaveBeenCalled()
  })
})
