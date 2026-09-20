import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  result as complianceResult,
  release as complianceRelease,
} from './test-fixtures/firmware-compliance'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  devices: vi.fn(),
  exceptions: vi.fn(),
  activeTargets: vi.fn(),
  compliance: vi.fn(),
  createPlan: vi.fn(),
  audit: vi.fn(),
}))

const tx = {
  device: { findMany: mocks.devices },
  firmwareException: { findMany: mocks.exceptions },
  firmwareWorkPlanTarget: { findMany: mocks.activeTargets },
  firmwareWorkPlan: { create: mocks.createPlan },
  auditEvent: { create: mocks.audit },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

vi.mock('@/lib/firmware-compliance-store', () => ({
  resolveFirmwareComplianceBatch: mocks.compliance,
}))

import {
  createFirmwareWorkPlan,
  parseFirmwareWorkPlanInput,
  previewFirmwareWorkPlan,
} from './firmware-work-plan-store'

function device(id: string) {
  return {
    id,
    name: `SW-${id}`,
    isActive: true,
    customerId: 'customer',
    siteId: 'site',
    deviceModelId: 'model',
    currentFirmwareReleaseId: '17.12.5',
    currentFirmwareObservedAt: new Date('2026-09-10T08:00:00Z'),
    currentFirmwareRawVersion: '17.12.5',
    currentFirmwareNormalizedVersion: '17.12.5',
    customer: { id: 'customer', name: 'Acme' },
    site: { id: 'site', name: 'HQ' },
    deviceModel: { id: 'model', model: 'C9300-24P', familyId: 'family' },
  }
}

function actionResult(targetId = 'target') {
  const target = complianceRelease('17.15.5', { id: targetId })
  return complianceResult({
    compliance: 'OUTSIDE_RANGE',
    recommendation: 'UPDATE_REQUIRED',
    preferredTarget: target,
    resolvedTarget: target,
    targetCompatibility: {
      status: 'RESOLVED',
      release: target,
      compatibleCandidates: [target],
      unknownCandidates: [],
      incompatibleCandidates: [],
      explanation: 'Resolved exact image',
    },
  })
}

function activeException(deviceId: string) {
  return {
    id: `exception-${deviceId}`,
    scope: 'DEVICE',
    scopeId: deviceId,
    scopeLabel: `SW-${deviceId}`,
    subject: 'ALL_MAINTENANCE',
    reasonCode: 'CUSTOMER_DECLINED',
    notes: null,
    releaseId: null,
    vendorId: null,
    platform: null,
    minimumVersion: null,
    maximumVersion: null,
    trainId: null,
    fromPlatform: null,
    toPlatform: null,
    duration: 'PERMANENT',
    expiresAt: null,
    policySnapshots: {},
    actorUserId: null,
    contactReference: null,
    ticketReference: null,
    decidedAt: new Date('2026-09-01T00:00:00Z'),
    supersededAt: null,
  }
}

describe('firmware work plan preview and creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    )
    mocks.exceptions.mockResolvedValue([])
    mocks.activeTargets.mockResolvedValue([])
    mocks.audit.mockResolvedValue({ id: 'audit' })
    mocks.createPlan.mockImplementation(async ({ data }) => ({
      id: 'plan-1',
      state: data.state,
      title: data.title,
      targets: data.targets.create,
      events: [data.events.create],
    }))
  })

  it('classifies included, excepted, already planned, no-action and review-required devices', async () => {
    const devices = ['1', '2', '3', '4', '5'].map(device)
    mocks.devices.mockResolvedValue(devices)
    mocks.exceptions.mockResolvedValue([activeException('2')])
    mocks.activeTargets.mockResolvedValue([{ deviceId: '3', planId: 'existing-plan' }])
    mocks.compliance.mockResolvedValue(
      new Map([
        ['1', actionResult()],
        ['2', actionResult()],
        ['3', actionResult()],
        ['4', complianceResult()],
        [
          '5',
          complianceResult({
            recommendation: 'REVIEW_REQUIRED',
            resolvedTarget: null,
            targetCompatibility: null,
          }),
        ],
      ]),
    )

    const preview = await previewFirmwareWorkPlan({
      deviceIds: devices.map((item) => item.id),
    })

    expect(preview.counts).toMatchObject({
      requested: 5,
      included: 1,
      activeException: 1,
      alreadyPlanned: 1,
      noAction: 1,
      reviewRequired: 1,
      exceptionOverrides: 0,
    })
    expect(
      Object.fromEntries(
        preview.targets.map((target) => [target.deviceId, target.disposition]),
      ),
    ).toEqual({
      '1': 'INCLUDED',
      '2': 'ACTIVE_EXCEPTION',
      '3': 'ALREADY_PLANNED',
      '4': 'NO_ACTION',
      '5': 'REVIEW_REQUIRED',
    })
  })

  it('only includes an excepted device when that exact device is explicitly overridden', async () => {
    mocks.devices.mockResolvedValue([device('1'), device('2')])
    mocks.exceptions.mockResolvedValue([activeException('2')])
    mocks.compliance.mockResolvedValue(
      new Map([
        ['1', actionResult()],
        ['2', actionResult()],
      ]),
    )

    const preview = await previewFirmwareWorkPlan({
      deviceIds: ['1', '2'],
      exceptionOverrideDeviceIds: ['2'],
    })

    expect(preview.counts).toMatchObject({
      included: 2,
      activeException: 0,
      exceptionOverrides: 1,
    })
    expect(preview.targets.find((target) => target.deviceId === '2')).toMatchObject({
      disposition: 'INCLUDED',
      effectiveExceptionId: 'exception-2',
      exceptionOverride: true,
    })
  })

  it('rejects an override for a device outside the selected population', () => {
    expect(() =>
      parseFirmwareWorkPlanInput({
        deviceIds: ['1'],
        exceptionOverrideDeviceIds: ['2'],
      }),
    ).toThrow('selected devices')
  })

  it('rejects creation when planning state changed since preview', async () => {
    mocks.devices.mockResolvedValue([device('1')])
    mocks.compliance.mockResolvedValue(new Map([['1', actionResult()]]))

    const preview = await previewFirmwareWorkPlan({ deviceIds: ['1'] })
    mocks.activeTargets.mockResolvedValue([
      { deviceId: '1', planId: 'created-elsewhere' },
    ])

    await expect(
      createFirmwareWorkPlan({ deviceIds: ['1'] }, preview.token, 'actor'),
    ).rejects.toMatchObject({ status: 409 })
    expect(mocks.createPlan).not.toHaveBeenCalled()
  })

  it('creates immutable per-device snapshots and an initial append-only event', async () => {
    mocks.devices.mockResolvedValue([device('1')])
    mocks.compliance.mockResolvedValue(new Map([['1', actionResult('target-1')]]))

    const raw = {
      deviceIds: ['1'],
      title: 'HQ switches',
      reason: 'Quarterly firmware maintenance',
    }
    const preview = await previewFirmwareWorkPlan(raw)
    const created = await createFirmwareWorkPlan(raw, preview.token, 'actor')

    expect(created).toMatchObject({ id: 'plan-1', state: 'PROPOSED' })
    const create = mocks.createPlan.mock.calls[0][0].data
    expect(create).toMatchObject({
      state: 'PROPOSED',
      title: 'HQ switches',
      reason: 'Quarterly firmware maintenance',
      createdByUserId: 'actor',
    })
    expect(create.targets.create).toHaveLength(1)
    expect(create.targets.create[0]).toMatchObject({
      deviceId: '1',
      deviceName: 'SW-1',
      customerName: 'Acme',
      siteName: 'HQ',
      recommendation: 'UPDATE_REQUIRED',
      observedFirmwareRawVersion: '17.12.5',
      targetFirmwareReleaseId: 'target-1',
      targetVersion: '17.15.5',
      exceptionOverride: false,
    })
    expect(create.events.create).toMatchObject({
      fromState: null,
      toState: 'PROPOSED',
      actorUserId: 'actor',
    })
    expect(mocks.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FIRMWARE_WORK_PLAN_CREATED',
        entityType: 'FirmwareWorkPlan',
        entityId: 'plan-1',
      }),
    })
  })
})
