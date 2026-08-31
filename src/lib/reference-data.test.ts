import { describe, expect, it } from 'vitest'
import {
  cleanReferenceCode,
  cleanReferenceName,
  findNormalizedNameConflict,
  normalizeReferenceName,
  parseReferenceInput,
  referencedRecordMessage,
} from '@/lib/reference-data'

describe('reference-data normalization', () => {
  it('normalizes display names without losing casing', () => {
    expect(cleanReferenceName('  Cisco   Systems  ')).toBe('Cisco Systems')
    expect(normalizeReferenceName('  CISCO   Systems ')).toBe('cisco systems')
  })

  it('canonicalizes codes', () => {
    expect(cleanReferenceCode(' access_point ')).toBe('ACCESS-POINT')
  })

  it('detects normalized name conflicts while allowing the edited record itself', () => {
    const records = [{ id: '1', name: 'Cisco Systems' }]
    expect(findNormalizedNameConflict(records, '  CISCO   SYSTEMS ')).toEqual(records[0])
    expect(findNormalizedNameConflict(records, 'Cisco Systems', '1')).toBeNull()
  })
})

describe('reference-data input validation', () => {
  it('parses contract firmware-management capability', () => {
    expect(
      parseReferenceInput('contract-types', {
        code: 'customer_managed',
        name: 'Customer Managed',
        description: 'Customer retains firmware responsibility.',
        firmwareManagementEnabled: false,
      }),
    ).toEqual({
      code: 'CUSTOMER-MANAGED',
      name: 'Customer Managed',
      description: 'Customer retains firmware responsibility.',
      firmwareManagementEnabled: false,
      isActive: true,
    })
  })

  it('rejects non-http vendor URLs', () => {
    expect(() =>
      parseReferenceInput('vendors', {
        code: 'TEST',
        name: 'Test vendor',
        websiteUrl: 'javascript:alert(1)',
      }),
    ).toThrow('Please correct the highlighted fields.')
  })
})

describe('reference-data deletion integrity', () => {
  it('blocks deletion when references exist and directs the user to archive', () => {
    expect(referencedRecordMessage('vendors', 2)).toContain('cannot be deleted')
    expect(referencedRecordMessage('vendors', 2)).toContain('Archive it instead')
  })

  it('allows deletion when no references exist', () => {
    expect(referencedRecordMessage('device-types', 0)).toBeNull()
  })
})
