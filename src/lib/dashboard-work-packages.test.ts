import { describe, expect, it } from 'vitest'
import {
  buildCandidateWorkPackages,
  countCandidateWorkPackages,
  type WorkPackageFinding,
} from './dashboard-work-packages'

function finding(overrides: Partial<WorkPackageFinding> = {}): WorkPackageFinding {
  return {
    deviceId: 'device-1',
    customer: { id: 'customer-1', name: 'Customer One' },
    site: { id: 'site-1', name: 'Main site' },
    deviceTypeId: 'firewall',
    vendor: { id: 'fortinet', name: 'Fortinet' },
    model: { id: 'FG-100F', name: 'FortiGate 100F' },
    firmwareKey: '7.4.5',
    status: 'UPDATE_REQUIRED',
    reason: 'An update is required by the approved firmware policy.',
    managementContractId: 'proactive',
    plan: null,
    ...overrides,
  }
}

describe('dashboard candidate work packages', () => {
  it('counts logical work packages rather than raw device count', () => {
    const packages = buildCandidateWorkPackages([
      finding(),
      finding({ deviceId: 'device-2' }),
      finding({ deviceId: 'device-2' }),
    ])
    expect(packages).toHaveLength(1)
    expect(packages[0].deviceCount).toBe(2)
    expect(packages[0].deviceIds).toEqual(['device-1', 'device-2'])
    expect(countCandidateWorkPackages(packages)).toEqual({
      URGENT: 0, TO_PLAN: 1, BLOCKED: 0, CHECK: 0,
    })
  })

  it('preserves customer, site, firmware and plan boundaries', () => {
    const packages = buildCandidateWorkPackages([
      finding({ deviceId: 'a' }),
      finding({ deviceId: 'b', customer: { id: 'customer-2', name: 'Customer Two' } }),
      finding({ deviceId: 'c', site: { id: 'site-2', name: 'Branch' } }),
      finding({ deviceId: 'd', firmwareKey: '7.4.8' }),
      finding({ deviceId: 'e', model: { id: 'FG-200F', name: 'FortiGate 200F' } }),
    ])
    expect(packages).toHaveLength(5)
    expect(packages.every((work) => work.deviceCount === 1)).toBe(true)
  })

  it('only classifies verified critical inventory status as urgent', () => {
    const packages = buildCandidateWorkPackages([
      finding({ deviceId: 'a', status: 'CRITICAL_ATTENTION' }),
      finding({ deviceId: 'b', status: 'UPDATE_REQUIRED' }),
      finding({ deviceId: 'c', status: 'UPDATE_RECOMMENDED' }),
      finding({ deviceId: 'd', status: 'UNKNOWN' }),
    ])
    expect(countCandidateWorkPackages(packages)).toEqual({
      URGENT: 1, TO_PLAN: 2, BLOCKED: 0, CHECK: 1,
    })
    expect(packages[0].kind).toBe('URGENT')
  })

  it('never calls a planned upgrade unplanned, and counts customer approval as workflow-blocked', () => {
    const packages = buildCandidateWorkPackages([
      finding({
        deviceId: 'planned',
        plan: { id: 'plan-1', state: 'SCHEDULED' },
      }),
      finding({
        deviceId: 'waiting',
        plan: { id: 'plan-2', state: 'AWAITING_CUSTOMER' },
      }),
    ])
    expect(countCandidateWorkPackages(packages)).toEqual({
      URGENT: 0, TO_PLAN: 0, BLOCKED: 1, CHECK: 0,
    })
    expect(packages[0].href).toBe('/planning/plan-2')
  })

  it('never treats release BLOCKED as a blocked workflow state', () => {
    const packages = buildCandidateWorkPackages([
      finding({ status: 'CRITICAL_ATTENTION', plan: null }),
    ])
    expect(countCandidateWorkPackages(packages)).toEqual({
      URGENT: 1, TO_PLAN: 0, BLOCKED: 0, CHECK: 0,
    })
  })

  it('records missing effective contracts as a separate check, never critical', () => {
    const packages = buildCandidateWorkPackages([
      finding({ managementContractId: null, status: 'CURRENT' }),
    ])
    expect(countCandidateWorkPackages(packages)).toEqual({
      URGENT: 0, TO_PLAN: 0, BLOCKED: 0, CHECK: 1,
    })
    expect(packages[0].href).toContain('contract=none')
    expect(packages[0].assigneeId).toBeNull()
    expect(packages[0].dueAt).toBeNull()
  })

  it('keeps unassigned-site work separate from real site groups', () => {
    const packages = buildCandidateWorkPackages([
      finding({ deviceId: 'unknown-site', site: null }),
      finding({ deviceId: 'real-site' }),
    ])
    expect(packages).toHaveLength(2)
    expect(packages.find((work) => work.site === null)?.href).toContain('/sites/unassigned/')
  })

  it('creates no false zeros or packages when the input has no findings', () => {
    expect(buildCandidateWorkPackages([])).toEqual([])
  })
})
