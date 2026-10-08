import { describe, expect, it } from 'vitest'
import { formatAmsterdamTimestamp } from '@/lib/format-amsterdam-timestamp'

describe('formatAmsterdamTimestamp', () => {
  it('renders the same deterministic Dutch date for ISO text and a Date object', () => {
    const source = '2026-10-08T20:13:33.000Z'
    expect(formatAmsterdamTimestamp(source)).toBe('08-10-2026 22:13:33')
    expect(formatAmsterdamTimestamp(new Date(source))).toBe('08-10-2026 22:13:33')
  })

  it('handles winter timezone offset without relying on the host timezone', () => {
    expect(formatAmsterdamTimestamp('2026-12-08T20:13:33.000Z'))
      .toBe('08-12-2026 21:13:33')
  })

  it('provides the same fallback for empty or invalid values', () => {
    expect(formatAmsterdamTimestamp(null)).toBe('—')
    expect(formatAmsterdamTimestamp(undefined)).toBe('—')
    expect(formatAmsterdamTimestamp('not-a-timestamp')).toBe('—')
  })
})
