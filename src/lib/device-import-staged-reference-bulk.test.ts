import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { parseBulkReferenceResolutionInput } from '@/lib/device-import-staged-reference-bulk-input'
import { stagedReferenceAliasContext } from '@/lib/device-import-staged-reference-bulk'

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
