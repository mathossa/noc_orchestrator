import { describe, expect, it } from 'vitest'
import { deviceFilterHref, technicalStateDeviceHref, workflowDeviceHref } from '@/lib/drilldown-links'

describe('firmware drill-down links', () => {
  it('builds composable backend device filter URLs', () => {
    expect(deviceFilterHref({ customer: 'customer-1', vendor: 'vendor-1', model: null })).toBe('/devices?customer=customer-1&vendor=vendor-1')
  })

  it('builds technical state journeys without changing the scope', () => {
    expect(technicalStateDeviceHref({ contract: 'contract-1' }, 'ACTION_REQUIRED')).toBe('/devices?contract=contract-1&technicalState=ACTION_REQUIRED')
  })

  it('builds workflow journeys including the no-decision state', () => {
    expect(workflowDeviceHref({ vendor: 'vendor-1' }, 'UNDECIDED')).toBe('/devices?vendor=vendor-1&workflow=UNDECIDED')
  })
})
