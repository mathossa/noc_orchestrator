import { describe, expect, it } from 'vitest'
import { parseInventoryQuery } from './inventory-explorer'
import { inventoryReportHref } from './inventory-report-context'

describe('inventory report filter links', () => {
  it('preserves active filters while applying an exact clicked dimension', () => {
    const query = parseInventoryQuery(new URLSearchParams({
      vendor: 'fortinet',
      deviceType: 'firewall',
      contract: 'managed',
      source: 'API',
    }))

    expect(
      inventoryReportHref(query, '7.4', {
        customer: 'customer-a',
        site: 'site-a',
      }),
    ).toBe(
      '/reports/inventory?customer=customer-a&site=site-a&vendor=fortinet&deviceType=firewall&contract=managed&source=API&firmware=7.4',
    )
  })

  it('can replace the running-firmware quick filter without losing URL filters', () => {
    const query = parseInventoryQuery(new URLSearchParams({
      customer: 'customer-a',
      status: 'update_required',
    }))

    expect(
      inventoryReportHref(query, '7.2', {}, '7.4.8'),
    ).toBe(
      '/reports/inventory?customer=customer-a&status=UPDATE_REQUIRED&firmware=7.4.8',
    )
  })

  it('clears Site when a Customer click explicitly resets it', () => {
    const query = parseInventoryQuery(new URLSearchParams({
      customer: 'customer-old',
      site: 'site-old',
      vendor: 'fortinet',
    }))

    expect(
      inventoryReportHref(query, '', {
        customer: 'customer-new',
        site: '',
      }),
    ).toBe(
      '/reports/inventory?customer=customer-new&vendor=fortinet',
    )
  })
})
