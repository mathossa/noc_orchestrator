import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  rowFindMany: vi.fn(),
  rowUpdate: vi.fn(),
  findCandidates: vi.fn(),
  effectiveOverlay: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2WorkspaceBatch: { findUnique: mocks.batchFindUnique },
    importerV2WorkspaceRow: {
      findMany: mocks.rowFindMany,
      update: mocks.rowUpdate,
    },
  },
}))

vi.mock('@/lib/importer-v2-identity-store', () => ({
  findImporterV2IdentityCandidates: mocks.findCandidates,
}))

vi.mock('@/lib/importer-v2-workspace-effective-overlay', () => ({
  importerV2WorkspaceEffectiveEvaluated: mocks.effectiveOverlay,
}))

import {
  reconcileImporterV2ManualIdentity,
  repairedRepeatClassification,
} from '@/lib/importer-v2-workspace-identity-repair'

describe('Importer v2 manual identity repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx-tabular-v1',
    })
    mocks.rowFindMany.mockResolvedValue([
      {
        id: 'row-13',
        repeatClassification: 'AMBIGUOUS',
        repeatDiff: null,
        identityResolution: { kind: 'INVALID' },
        evaluated: {},
        decisions: [
          {
            field: 'serialNumber',
            action: 'SET_FIELD',
            value: { id: null, label: 'SER-123' },
            explanation: 'Manual serial.',
            actorUserId: null,
            createdAt: new Date('2026-09-10T08:00:00Z'),
          },
        ],
      },
    ])
    mocks.effectiveOverlay.mockReturnValue({
      evaluated: {
        rawValues: {
          deviceName: 'stale-switch',
          customer: 'Example customer',
          site: 'Zwolle',
        },
        proposedCanonicalValues: {
          serialNumber: { id: null, label: 'SER-123' },
        },
      },
    })
    mocks.rowUpdate.mockResolvedValue({ id: 'row-13' })
  })

  it('turns a manually supplied serial that already exists into an existing-device suggestion, not NEW', async () => {
    mocks.findCandidates.mockResolvedValue([
      {
        canonicalDeviceId: 'device-existing',
        crosswalkId: 'crosswalk-1',
        identifiers: {
          sourceId: null,
          serialNumber: 'SER-123',
          macAddress: null,
        },
      },
    ])

    const result = await reconcileImporterV2ManualIdentity('batch-1')

    expect(mocks.findCandidates).toHaveBeenCalledWith({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx-tabular-v1',
      identifiers: {
        sourceId: null,
        serialNumber: 'SER-123',
        macAddress: null,
      },
    })
    expect(mocks.rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-13' },
      data: {
        identityResolution: expect.objectContaining({
          kind: 'MATCH_SUGGESTED',
          requiresConfirmation: true,
          candidates: [
            expect.objectContaining({
              canonicalDeviceId: 'device-existing',
              confidence: 'MEDIUM',
            }),
          ],
        }),
        repeatClassification: 'CHANGED',
        repeatDiff: null,
        reviewRevision: { increment: 1 },
      },
    })
    expect(result).toMatchObject({
      repairedRowCount: 1,
      matchedExistingCount: 1,
      newCount: 0,
    })
  })

  it('keeps a manually supplied durable identity as NEW only when no provider crosswalk matches it', async () => {
    mocks.findCandidates.mockResolvedValue([])

    const result = await reconcileImporterV2ManualIdentity('batch-1')

    expect(mocks.rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-13' },
      data: expect.objectContaining({
        identityResolution: expect.objectContaining({
          kind: 'NEW',
          requiresConfirmation: false,
          candidates: [],
        }),
        repeatClassification: 'NEW',
        repeatDiff: null,
        reviewRevision: { increment: 1 },
      }),
    })
    expect(result).toMatchObject({
      repairedRowCount: 1,
      matchedExistingCount: 0,
      newCount: 1,
    })
  })

  it('does not rewrite or bump QA revision when live identity is already current', async () => {
    const liveResolution = {
      kind: 'NEW',
      requiresConfirmation: false,
      normalizedIdentifiers: {
        sourceId: null,
        serialNumber: 'SER-123',
        macAddress: null,
      },
      candidates: [],
      options: ['CREATE_NEW', 'MANUAL_OVERRIDE'],
      explanation:
        'No canonical device is supported by the supplied durable identifiers. The row can be proposed as a new device without per-row confirmation; final batch publication remains explicit.',
    }
    mocks.rowFindMany.mockResolvedValue([
      {
        id: 'row-13',
        repeatClassification: 'NEW',
        repeatDiff: null,
        identityResolution: liveResolution,
        evaluated: {},
        decisions: [
          {
            field: 'serialNumber',
            action: 'SET_FIELD',
            value: { id: null, label: 'SER-123' },
            explanation: 'Manual serial.',
            actorUserId: null,
            createdAt: new Date('2026-09-10T08:00:00Z'),
          },
        ],
      },
    ])
    mocks.findCandidates.mockResolvedValue([])

    const result = await reconcileImporterV2ManualIdentity('batch-1')

    expect(mocks.rowUpdate).not.toHaveBeenCalled()
    expect(result.repairedRowCount).toBe(0)
  })

  it('maps repaired repeat state conservatively when identity changes', () => {
    expect(
      repairedRepeatClassification({
        current: 'AMBIGUOUS',
        identityKind: 'MATCH_SUGGESTED',
      }),
    ).toBe('CHANGED')
    expect(
      repairedRepeatClassification({
        current: 'AMBIGUOUS',
        identityKind: 'NEW',
      }),
    ).toBe('NEW')
    expect(
      repairedRepeatClassification({
        current: 'CHANGED',
        identityKind: 'AMBIGUOUS',
      }),
    ).toBe('AMBIGUOUS')
  })
})
