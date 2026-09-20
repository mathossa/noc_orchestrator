import { describe, expect, it } from 'vitest'
import PlanningPage from '@/app/(app)/planning/page'
import NewPlanningPage from '@/app/(app)/planning/new/page'
import PlanningDetailPage from '@/app/(app)/planning/[id]/page'
import { FirmwarePlanCreate } from './firmware-plan-create'
import { FirmwarePlanDetail } from './firmware-plan-detail'
import { FirmwarePlanList } from './firmware-plan-list'

describe('planning routes', () => {
  it('/planning renders the persistent plan list', async () => {
    const element = await PlanningPage({
      searchParams: Promise.resolve({}),
    })
    expect(element.type).toBe(FirmwarePlanList)
    expect(element.props.initialView).toBe('active')
  })

  it('/planning retains terminal history as a separate list view', async () => {
    const element = await PlanningPage({
      searchParams: Promise.resolve({ view: 'history' }),
    })
    expect(element.type).toBe(FirmwarePlanList)
    expect(element.props.initialView).toBe('history')
  })

  it('/planning/new is a dedicated creation workspace', () => {
    const element = NewPlanningPage()
    expect(element.type).toBe(FirmwarePlanCreate)
  })

  it('/planning/[id] reconstructs the detail workspace from the route id alone', async () => {
    const element = await PlanningDetailPage({
      params: Promise.resolve({ id: 'plan-123' }),
    })
    expect(element.type).toBe(FirmwarePlanDetail)
    expect(element.props.planId).toBe('plan-123')
  })
})
