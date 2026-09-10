import { describe, expect, it } from 'vitest'
import { importerV2BulkIdentityDecision } from '@/lib/importer-v2-workspace-bulk-identity'
import type { ImporterV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

function review(
  overrides: Partial<ImporterV2WorkspaceIdentityReview> = {},
): ImporterV2WorkspaceIdentityReview {
  return {
    kind: 'MATCH_SUGGESTED',
    requiresConfirmation: true,
    resolved: false,
    selectedDecision: null,
    selectedCanonicalDeviceId: null,
    explanation: 'One durable identity candidate.',
    candidates: [
      {
        canonicalDeviceId: 'device-1',
        confidence: 'MEDIUM',
        explanation: 'Serial number agrees.',
        durableEvidence: ['SERIAL_NUMBER'],
        signals: [],
        contextDifferences: [],
      },
    ],
    options: ['CONFIRM_MATCH', 'CREATE_NEW'],
    ...overrides,
  }
}

describe('Importer v2 bulk identity verification policy', () => {
  it('bulk verifies one unambiguous suggested identity candidate', () => {
    expect(importerV2BulkIdentityDecision(review())).toEqual({
      kind: 'CONFIRM_MATCH',
      canonicalDeviceId: 'device-1',
      explanation:
        'Bulk verified the single unambiguous staged identity candidate from durable source evidence.',
    })
  })

  it('does not bulk choose between ambiguous candidates', () => {
    expect(
      importerV2BulkIdentityDecision(
        review({
          kind: 'AMBIGUOUS',
          candidates: [
            ...review().candidates,
            {
              canonicalDeviceId: 'device-2',
              confidence: 'MEDIUM',
              explanation: 'MAC address points elsewhere.',
              durableEvidence: ['MAC_ADDRESS'],
              signals: [],
              contextDifferences: [],
            },
          ],
          options: ['CHOOSE_CANDIDATE', 'CREATE_NEW'],
        }),
      ),
    ).toBeNull()
  })

  it('does not bulk accept a conflicting ambiguous identity even with one candidate', () => {
    expect(
      importerV2BulkIdentityDecision(
        review({
          kind: 'AMBIGUOUS',
          explanation: 'One durable identifier agrees while another conflicts.',
        }),
      ),
    ).toBeNull()
  })

  it('does nothing for identities already resolved automatically or explicitly', () => {
    expect(
      importerV2BulkIdentityDecision(
        review({
          resolved: true,
          requiresConfirmation: false,
          selectedDecision: 'CONFIRM_MATCH',
          selectedCanonicalDeviceId: 'device-1',
        }),
      ),
    ).toBeNull()
  })

  it('does not bulk verify invalid or missing identity evidence', () => {
    expect(importerV2BulkIdentityDecision(null)).toBeNull()
    expect(
      importerV2BulkIdentityDecision(
        review({
          kind: 'INVALID',
          requiresConfirmation: false,
          candidates: [],
          options: [],
        }),
      ),
    ).toBeNull()
  })
})
