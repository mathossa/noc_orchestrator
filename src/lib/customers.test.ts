import { describe, expect, it } from 'vitest'
import { CustomerValidationError, cleanCustomerCode, cleanCustomerName, parseCustomerInput } from '@/lib/customers'

describe('customer validation', () => {
  it('cleans customer names without requiring an external identity', () => {
    expect(cleanCustomerName('  Example   Customer  ')).toBe('Example Customer')
    expect(parseCustomerInput({ name: 'Example Customer' })).toEqual({
      name: 'Example Customer',
      code: null,
      contractTypeId: null,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
      isActive: true,
    })
  })

  it('canonicalizes optional customer codes', () => {
    expect(cleanCustomerCode(' acme_nl ')).toBe('ACME-NL')
  })

  it('accepts API provenance with optional provider and external ID', () => {
    expect(
      parseCustomerInput({
        name: 'API Customer',
        source: 'API',
        externalProvider: 'inventory-platform',
        externalId: 'cust-123',
      }),
    ).toMatchObject({
      source: 'API',
      externalProvider: 'inventory-platform',
      externalId: 'cust-123',
    })
  })

  it('rejects an empty customer name', () => {
    expect(() => parseCustomerInput({ name: '   ' })).toThrow(CustomerValidationError)
  })

  it('rejects unsupported source values in the v0.1 API', () => {
    expect(() => parseCustomerInput({ name: 'Customer', source: 'UNKNOWN' })).toThrow(CustomerValidationError)
  })
})
