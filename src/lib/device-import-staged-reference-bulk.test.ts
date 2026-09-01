import { describe, expect, it } from 'vitest'
import { parseBulkReferenceResolutionInput } from '@/lib/device-import-staged-reference-bulk'

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
