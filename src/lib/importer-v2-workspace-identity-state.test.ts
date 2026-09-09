import { describe, expect, it } from 'vitest'
import {
  importerV2WorkspaceIdentityNeedsReview,
  importerV2WorkspaceIdentityReview,
} from '@/lib/importer-v2-workspace-identity-state'

describe('Importer v2 workspace identity review state', () => {
  it('automatically accepts a high-confidence #47 identity resolver match', () => {
    const review = importerV2WorkspaceIdentityReview({
      identityResolution: {
        kind: 'MATCH_SUGGESTED',
        requiresConfirmation: false,
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
      requiresConfirmation: false,
      resolved: true,
      selectedDecision: 'CONFIRM_MATCH',
      selectedCanonicalDeviceId: 'device-1',
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

  it('treats a safe NEW identity as an automatic create proposal', () => {
    const review = importerV2WorkspaceIdentityReview({
      identityResolution: {
        kind: 'NEW',
        requiresConfirmation: false,
        options: ['CREATE_NEW', 'MANUAL_OVERRIDE'],
        explanation: 'No existing durable identity match.',
        candidates: [],
      },
      decisions: [],
    })

    expect(review).toMatchObject({
      kind: 'NEW',
      requiresConfirmation: false,
      resolved: true,
      selectedDecision: 'CREATE_NEW',
      selectedCanonicalDeviceId: null,
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

  it('turns an invalid stale row into a safe new-device proposal after manual serial entry', () => {
    const input = {
      identityResolution: {
        kind: 'INVALID',
        requiresConfirmation: true,
        explanation: 'No source ID, serial number or MAC address was reported.',
        candidates: [],
      },
      decisions: [
        {
          field: 'serialNumber',
          action: 'SET_FIELD',
          value: { id: null, label: 'MANUAL-SERIAL-123' },
        },
      ],
    }

    expect(importerV2WorkspaceIdentityNeedsReview(input)).toBe(false)
    expect(importerV2WorkspaceIdentityReview(input)).toMatchObject({
      kind: 'NEW',
      requiresConfirmation: false,
      resolved: true,
      selectedDecision: 'CREATE_NEW',
      selectedCanonicalDeviceId: null,
    })
  })

  it('keeps an invalid stale row blocked when a manually entered durable identifier is cleared', () => {
    const input = {
      identityResolution: {
        kind: 'INVALID',
        requiresConfirmation: true,
        candidates: [],
      },
      decisions: [
        {
          field: 'serialNumber',
          action: 'SET_FIELD',
          value: { id: null, label: 'TEMP-SERIAL' },
        },
        {
          field: 'serialNumber',
          action: 'CLEAR_FIELD',
          value: null,
        },
      ],
    }

    expect(importerV2WorkspaceIdentityNeedsReview(input)).toBe(true)
    expect(importerV2WorkspaceIdentityReview(input)).toMatchObject({
      kind: 'INVALID',
      resolved: false,
    })
  })
})
