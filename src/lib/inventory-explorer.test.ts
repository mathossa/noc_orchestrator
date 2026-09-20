import { describe, expect, it } from 'vitest'
import {
  inventoryHref,
  parseInventoryQuery,
  searchParamsToUrlSearchParams,
} from './inventory-explorer'

describe('inventory explorer query', () => {
  it('parses bounded pagination, attention and primary status filters', () => {
    const query = parseInventoryQuery(
      new URLSearchParams({
        q: '  HQ-SW-01  ',
        attention: '1',
        status: 'update_required',
        page: '2',
        pageSize: '50',
      }),
    )

    expect(query).toMatchObject({
      q: 'HQ-SW-01',
      attention: true,
      status: 'UPDATE_REQUIRED',
      page: 2,
      pageSize: 50,
    })
  })

  it('falls back to bounded defaults for unsupported paging values', () => {
    const query = parseInventoryQuery(
      new URLSearchParams({ page: '-1', pageSize: '1000' }),
    )
    expect(query.page).toBe(1)
    expect(query.pageSize).toBe(25)
  })

  it('builds stable scoped navigation while resetting only requested state', () => {
    const query = parseInventoryQuery(
      new URLSearchParams({ q: 'cisco', vendor: 'vendor-1', page: '3' }),
    )
    expect(
      inventoryHref('/devices/customers/customer-1', query, {
        attention: true,
        page: 1,
      }),
    ).toBe(
      '/devices/customers/customer-1?q=cisco&vendor=vendor-1&attention=1',
    )
  })

  it('converts Next search params without dropping repeated values', () => {
    const params = searchParamsToUrlSearchParams({
      q: 'switch',
      tag: ['one', 'two'],
      empty: undefined,
    })
    expect(params.get('q')).toBe('switch')
    expect(params.getAll('tag')).toEqual(['one', 'two'])
  })
})
