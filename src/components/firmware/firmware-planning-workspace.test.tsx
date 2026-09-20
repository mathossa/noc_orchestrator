import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FirmwarePlanList } from './planning/firmware-plan-list'
import { PlanStatePill } from './planning/planning-ui'

describe('plan-centric firmware planning overview', () => {
  it('renders the plan overview and create route rather than the old giant creation/detail workspace', () => {
    const markup = renderToStaticMarkup(
      createElement(FirmwarePlanList, { initialView: 'active' }),
    )

    expect(markup).toContain('Existing maintenance plans')
    expect(markup).toContain('href="/planning/new"')
    expect(markup).toContain('+ Create maintenance plan')
    expect(markup).not.toContain('Create from selected devices')
    expect(markup).not.toContain('Plan detail')
  })

  it('marks stale active planning state prominently', () => {
    const markup = renderToStaticMarkup(
      createElement(PlanStatePill, { state: 'SCHEDULED', stale: true }),
    )
    expect(markup).toContain('Scheduled')
    expect(markup).toContain('review')
  })
})
