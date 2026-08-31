import { describe, expect, it } from 'vitest'
import { FirmwareLifecycleValidationError, parseFirmwareLifecycleInput } from '@/lib/firmware-lifecycle'

describe('firmware lifecycle decision input', () => {
  it('accepts planned decisions with an optional planned date', () => {
    const result = parseFirmwareLifecycleInput({ state: 'planned', plannedFor: '2026-09-15T20:00:00Z' })
    expect(result.state).toBe('PLANNED')
    expect(result.plannedFor?.toISOString()).toBe('2026-09-15T20:00:00.000Z')
    expect(result.reviewAt).toBeNull()
  })

  it('requires a reason for ignored decisions', () => {
    expect(() => parseFirmwareLifecycleInput({ state: 'IGNORED' })).toThrow(FirmwareLifecycleValidationError)
  })

  it('requires a reason for customer-declined decisions', () => {
    expect(() => parseFirmwareLifecycleInput({ state: 'CUSTOMER_DECLINED', notes: 'Customer email received.' })).toThrow(FirmwareLifecycleValidationError)
  })

  it('keeps review date for ignored/declined and drops unrelated planned date', () => {
    const result = parseFirmwareLifecycleInput({
      state: 'CUSTOMER_DECLINED',
      reason: 'Maintenance window was not approved.',
      notes: 'Review next quarter.',
      plannedFor: '2026-09-10T10:00:00Z',
      reviewAt: '2026-12-01T10:00:00Z',
    })
    expect(result.plannedFor).toBeNull()
    expect(result.reviewAt?.toISOString()).toBe('2026-12-01T10:00:00.000Z')
  })

  it('rejects invalid workflow states cleanly', () => {
    expect(() => parseFirmwareLifecycleInput({ state: 'SKIPPED' })).toThrow(FirmwareLifecycleValidationError)
  })
})
