import { describe, expect, it } from 'vitest'
import { isActivePath } from './app-shell'

describe('app shell inventory navigation', () => {
  it('keeps customer-scoped site routes under Customers', () => {
    expect(isActivePath('/customers', '/customers')).toBe(true)
    expect(isActivePath('/customers/customer-1', '/customers')).toBe(true)
    expect(isActivePath('/customers/customer-1/sites', '/customers')).toBe(true)
    expect(isActivePath('/customers/customer-1/sites/site-1', '/customers')).toBe(true)

    expect(isActivePath('/customers/customer-1/sites/site-1', '/sites')).toBe(false)
  })

  it('uses All sites only for standalone site routes', () => {
    expect(isActivePath('/sites', '/sites')).toBe(true)
    expect(isActivePath('/sites/example', '/sites')).toBe(true)
    expect(isActivePath('/sites', '/customers')).toBe(false)
  })
})
