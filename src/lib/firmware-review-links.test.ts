import { describe, expect, it } from 'vitest'
import {
  firmwareReviewCycleHref,
  firmwareReviewExceptionHref,
  firmwareReviewInventoryHref,
  firmwareReviewPlanHref,
  firmwareReviewReleaseHref,
  firmwareReviewSiteHref,
  firmwareReviewTrainHref,
} from '@/lib/firmware-review-links'

describe('firmware review traceability links', () => {
  it('links report versions without regenerating them from live state', () => {
    expect(firmwareReviewCycleHref('cycle 1', 3)).toBe(
      '/reports/cycle%201?version=3',
    )
  })

  it('uses the existing customer Site workspace', () => {
    expect(firmwareReviewSiteHref('customer-1', 'site-1')).toBe(
      '/customers/customer-1/sites/site-1',
    )
  })

  it('uses the #107 scoped inventory explorer instead of a report-owned device table', () => {
    expect(
      firmwareReviewInventoryHref({
        customerId: 'customer-1',
        siteId: 'site-1',
        deviceTypeId: 'switch',
        modelId: 'model-1',
      }),
    ).toBe(
      '/devices/customers/customer-1/sites/site-1/types/switch?model=model-1',
    )

    expect(
      firmwareReviewInventoryHref({
        customerId: 'customer-1',
        modelId: 'model-1',
      }),
    ).toBe('/devices/customers/customer-1?model=model-1')
  })

  it('reuses planning, exception and firmware catalog routes', () => {
    expect(firmwareReviewPlanHref('plan-1')).toBe('/planning/plan-1')
    expect(firmwareReviewExceptionHref('SITE', 'site-1')).toBe(
      '/firmware/exceptions?scope=SITE&scopeId=site-1',
    )
    expect(firmwareReviewReleaseHref('release-1')).toBe('/firmware/release-1')
    expect(firmwareReviewTrainHref('train-1')).toBe(
      '/firmware/trains/train-1',
    )
  })
})
