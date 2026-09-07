import { describe, expect, it } from 'vitest'
import {
  importerV2WorkspaceIdentityNeedsReview,
  importerV2WorkspaceIdentityReview,
} from '@/lib/importer-v2-workspace-identity-state'

describe('Importer v2 workspace identity review state', () => {
  it('normalizes the #47 identity resolver shape', () => {
    const review = importerV2WorkspaceIdentityReview({
      identityResolution: {
        kind: 'MATCH_SUGGESTED',
        requiresConfirmation: true,
        options: ['CONFIRM_MATCH', 'CREATE_NEW'],
        explanation: 'One durable candidate.',
        candidates: [
          {
            canonicalDeviceId: 'device-1',
            confidence: 'HIGH',
            explanation: 'Serial and MAC agree.',
            signals: [
              {
                kind: 'SERIAL_NUMBER',
                sourceValue: 'SRC-SERIAL',
                candidateValue: 'SRC-SERIAL',
                status: 'AGREE',
              },
              {
                kind: 'MAC_ADDRESS',
                sourceValue: 'AABBCCDDEEFF',
                candidateValue: 'AABBCCDDEEFF',
                status: 'AGREE',
              },
            ],
            contextDifferences: [
              { field: 'site', sourceValue: 'New site', candidateValue: 'Old site' },
            ],
          },
        ],
      },
      decisions: [],
    })

    expect(review).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: true,
      resolved: false,
      candidates: [
        {
          canonicalDeviceId: 'device-1',
          confidence: 'HIGH',
          durableEvidence: ['SERIAL_NUMBER', 'MAC_ADDRESS'],
          signals: [
            {
              kind: 'SERIAL_NUMBER',
              candidateValue: 'SRC-SERIAL',
              status: 'AGREE',
            },
            {
              kind: 'MAC_ADDRESS',
              candidateValue: 'AABBCCDDEEFF',
              status: 'AGREE',
            },
          ],
        },
      ],
    })
  })

  it('normalizes the synthetic fixture shape', () => {
    const review = importerV2WorkspaceIdentityReview({
      identityResolution: {
        status: 'REVIEW_REQUIRED',
        candidates: [
          {
            deviceId: 'device-7',
            confidence: 'MEDIUM',
            evidence: ['serialNumber', 'macAddress'],
          },
        ],
      },
      decisions: [],
    })
    expect(review?.requiresConfirmation).toBe(true)
    expect(review?.candidates[0]?.canonicalDeviceId).toBe('device-7')
    expect(review?.candidates[0]?.signals).toEqual([])
  })

  it('stops blocking review after an explicit identity decision', () => {
    const input = {
      identityResolution: {
        kind: 'AMBIGUOUS',
        requiresConfirmation: true,
        candidates: [
          { canonicalDeviceId: 'a', confidence: 'HIGH' },
          { canonicalDeviceId: 'b', confidence: 'MEDIUM' },
        ],
      },
      decisions: [
        {
          action: 'IDENTITY_RESOLUTION',
          value: {
            kind: 'CHOOSE_CANDIDATE',
            canonicalDeviceId: 'b',
          },
        },
      ],
    }

    expect(importerV2WorkspaceIdentityNeedsReview(input)).toBe(false)
    expect(importerV2WorkspaceIdentityReview(input)).toMatchObject({
      resolved: true,
      selectedDecision: 'CHOOSE_CANDIDATE',
      selectedCanonicalDeviceId: 'b',
    })
  })
})
