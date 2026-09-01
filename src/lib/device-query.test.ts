import { describe, expect, it } from 'vitest'
import { DeviceQueryValidationError, parseDeviceQuery } from '@/lib/device-query'

describe('device query parsing', () => {
  it('applies deterministic defaults', () => {
    expect(parseDeviceQuery(new URLSearchParams())).toEqual({
      q: '', customer: '', site: '', vendor: '', model: '', deviceType: '', contract: '',
      currentFirmware: '', desiredFirmware: '', technicalState: '', workflow: '', source: '',
      archive: 'active', groupBy: 'none', page: 1, pageSize: 50, sort: 'customer', direction: 'asc',
    })
  })

  it('parses composable filter, grouping, pagination and sort parameters', () => {
    const params = new URLSearchParams({
      customer: 'customer-1', site: 'site-1', vendor: 'vendor-1', model: 'model-1',
      deviceType: 'type-1', contract: 'contract-1', currentFirmware: 'fw-old', desiredFirmware: 'fw-new',
      technicalState: 'action_required', workflow: 'customer_declined', source: 'api', archive: 'all',
      groupBy: 'site', page: '3', pageSize: '25', sort: 'model', direction: 'desc', q: ' branch ',
    })
    expect(parseDeviceQuery(params)).toMatchObject({
      customer: 'customer-1', site: 'site-1', vendor: 'vendor-1', model: 'model-1', deviceType: 'type-1',
      contract: 'contract-1', currentFirmware: 'fw-old', desiredFirmware: 'fw-new',
      technicalState: 'ACTION_REQUIRED', workflow: 'CUSTOMER_DECLINED', source: 'API', archive: 'all',
      groupBy: 'site', page: 3, pageSize: 25, sort: 'model', direction: 'desc', q: 'branch',
    })
  })

  it('rejects unsupported state, grouping, page size and sort values', () => {
    const params = new URLSearchParams({ technicalState: 'AHEAD', groupBy: 'vendor', pageSize: '500', sort: 'random' })
    expect(() => parseDeviceQuery(params)).toThrow(DeviceQueryValidationError)
    try {
      parseDeviceQuery(params)
    } catch (error) {
      expect((error as DeviceQueryValidationError).fields).toMatchObject({
        technicalState: expect.any(String), groupBy: expect.any(String), pageSize: expect.any(String), sort: expect.any(String),
      })
    }
  })
})
