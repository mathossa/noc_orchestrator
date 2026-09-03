import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { parseBulkReferenceResolutionInput } from '@/lib/device-import-staged-reference-bulk-input'
import {
  firmwareTargetMatchesResolvedModel,
  linkedFirmwareReferenceMetadata,
  stagedReferenceAliasContext,
} from '@/lib/device-import-staged-reference-bulk'

describe('parseBulkReferenceResolutionInput', () => {
  it('accepts mixed remember modes in one backend request', () => {
    expect(parseBulkReferenceResolutionInput({
      batchId: 'batch-1',
      items: [
        { referenceId: 'ref-1', targetId: 'target-1', remember: true },
        { referenceId: 'ref-2', targetId: 'target-2', remember: false },
      ],
    })).toEqual({
      batchId: 'batch-1',
      items: [
        { referenceId: 'ref-1', targetId: 'target-1', remember: true },
        { referenceId: 'ref-2', targetId: 'target-2', remember: false },
      ],
    })
  })

  it('rejects duplicate staged references', () => {
    expect(() => parseBulkReferenceResolutionInput({
      batchId: 'batch-1',
      items: [
        { referenceId: 'ref-1', targetId: 'target-1' },
        { referenceId: 'ref-1', targetId: 'target-2' },
      ],
    })).toThrow(/only appear once/i)
  })

  it('requires at least one complete mapping', () => {
    expect(() => parseBulkReferenceResolutionInput({ batchId: 'batch-1', items: [] })).toThrow(/at least one/i)
    expect(() => parseBulkReferenceResolutionInput({
      batchId: 'batch-1',
      items: [{ referenceId: 'ref-1', targetId: '' }],
    })).toThrow(/needs a staged reference and target/i)
  })
})

describe('stagedReferenceAliasContext', () => {
  it('does not create a partial Firmware context when Platform was inferred later', () => {
    expect(stagedReferenceAliasContext({
      kind: 'FIRMWARE_RELEASE',
      metadata: { vendorTargetId: 'vendor-cisco', platform: null },
    })).toBe('')
  })

  it('keeps a complete canonical Firmware context when Vendor and Platform are known', () => {
    expect(stagedReferenceAliasContext({
      kind: 'FIRMWARE_RELEASE',
      metadata: { vendorTargetId: 'vendor-cisco', platform: ' IOS ' },
    })).toBe('vendor-cisco|ios')
  })
})

describe('firmwareTargetMatchesResolvedModel', () => {
  it('uses the resolved Model as authority when staged Firmware Platform metadata is stale', () => {
    expect(firmwareTargetMatchesResolvedModel(
      'FortiAP OS/firmware',
      { platform: 'FortiAP OS/firmware', supportedPlatforms: [] },
      'FortiOS',
    )).toBe(true)
  })

  it('allows another Platform explicitly supported by a multi-platform Model', () => {
    expect(firmwareTargetMatchesResolvedModel(
      'AOS 10',
      {
        platform: 'AOS 8',
        supportedPlatforms: [{ platform: 'AOS 8' }, { platform: 'AOS 10' }],
      },
      'AOS 8',
    )).toBe(true)
  })

  it('rejects a release Platform that the resolved Model does not support', () => {
    expect(firmwareTargetMatchesResolvedModel(
      'FortiOS',
      { platform: 'FortiAP OS/firmware', supportedPlatforms: [] },
      'FortiOS',
    )).toBe(false)
  })

  it('falls back to staged Platform when an older Model has no Platform information', () => {
    expect(firmwareTargetMatchesResolvedModel(
      'IOS',
      { platform: null, supportedPlatforms: [] },
      'Sx350',
    )).toBe(false)
    expect(firmwareTargetMatchesResolvedModel(
      'Sx350',
      { platform: null, supportedPlatforms: [] },
      'Sx350',
    )).toBe(true)
  })
})

describe('linkedFirmwareReferenceMetadata', () => {
  it('persists the accepted release Platform so a refresh cannot reopen the same Firmware reference', () => {
    const result = linkedFirmwareReferenceMetadata({
      modelTargetId: 'model-c2960x-48fps',
      vendorTargetId: 'vendor-cisco',
      platform: null,
      platforms: [],
      waitingFor: [],
    }, {
      vendorId: 'vendor-cisco',
      platform: 'IOS',
    })

    expect(result).toMatchObject({
      modelTargetId: 'model-c2960x-48fps',
      vendorTargetId: 'vendor-cisco',
      platform: 'IOS',
      platforms: ['IOS'],
      waitingFor: [],
    })
    expect(stagedReferenceAliasContext({ kind: 'FIRMWARE_RELEASE', metadata: result })).toBe('vendor-cisco|ios')
  })
})