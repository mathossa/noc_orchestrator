import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceRecord } from '@/lib/devices'

const mocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  customerCount: vi.fn(),
  modelCount: vi.fn(),
  vendorCount: vi.fn(),
  policyFindMany: vi.fn(),
  auditFindMany: vi.fn(),
}))

vi.mock('@/lib/device-store', () => ({ listDevices: mocks.listDevices }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: { count: mocks.customerCount },
    deviceModel: { count: mocks.modelCount },
    vendor: { count: mocks.vendorCount },
    firmwarePolicy: { findMany: mocks.policyFindMany },
    auditEvent: { findMany: mocks.auditFindMany },
  },
}))

import { getFirmwareLifecycleDashboard } from '@/lib/dashboard-store'

function device({
  id,
  customerId,
  customerName,
  customerCode,
  modelId,
  modelName,
  vendorId,
  vendorName,
  currentId,
  currentVersion,
  workflow,
  active = true,
}: {
  id: string
  customerId: string
  customerName: string
  customerCode?: string
  modelId: string
  modelName: string
  vendorId: string
  vendorName: string
  currentId: string | null
  currentVersion?: string
  workflow?: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
  active?: boolean
}): DeviceRecord {
  return {
    id,
    customerId,
    siteId: null,
    deviceModelId: modelId,
    name: id.toUpperCase(),
    hostname: null,
    serialNumber: null,
    managementAddress: null,
    notes: null,
    currentFirmwareReleaseId: currentId,
    currentFirmwareObservedAt: null,
    currentFirmwareAgeDays: null,
    currentFirmwareSource: 'MANUAL',
    isActive: active,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    customer: {
      id: customerId,
      code: customerCode ?? null,
      name: customerName,
      isActive: true,
      contractType: null,
    },
    site: null,
    effectiveContractType: null,
    contractSource: 'NONE',
    deviceModel: {
      id: modelId,
      model: modelName,
      platform: 'NOS',
      isActive: true,
      vendor: { id: vendorId, code: vendorName.toUpperCase(), name: vendorName, isActive: true },
      deviceType: { id: 'type-switch', code: 'SWITCH', name: 'Switches', isActive: true },
    },
    currentFirmwareRelease: currentId
      ? {
          id: currentId,
          vendorId,
          platform: 'NOS',
          version: currentVersion ?? currentId,
          status: 'APPROVED',
          isActive: true,
          firmwareTrain: null,
          releasedAt: null,
        }
      : null,
    lifecycle: workflow
      ? {
          id: `lifecycle-${id}`,
          state: workflow,
          reason: null,
          notes: null,
          plannedFor: null,
          reviewAt: null,
          decidedAt: '2026-09-01T09:00:00.000Z',
          completedAt: workflow === 'DONE' ? '2026-09-01T09:00:00.000Z' : null,
          decidedBy: null,
          targetFirmwareRelease: { id: 'target', version: 'target', platform: 'NOS' },
        }
      : null,
  }
}

describe('firmware lifecycle dashboard aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerCount.mockResolvedValue(3)
    mocks.modelCount.mockResolvedValue(3)
    mocks.vendorCount.mockResolvedValue(2)
    mocks.auditFindMany.mockResolvedValue([])
    mocks.policyFindMany.mockResolvedValue([
      { deviceModelId: 'model-1', targetFirmwareReleaseId: 'release-1' },
      { deviceModelId: 'model-2', targetFirmwareReleaseId: 'release-2' },
    ])
  })

  it('keeps technical state and workflow counts independent and excludes archived devices', async () => {
    mocks.listDevices.mockResolvedValue([
      device({ id: 'device-1', customerId: 'customer-1', customerName: 'Alpha', customerCode: 'ALPHA', modelId: 'model-1', modelName: 'Switch 48', vendorId: 'vendor-1', vendorName: 'Vendor A', currentId: 'release-1', currentVersion: '1.0', workflow: 'PLANNED' }),
      device({ id: 'device-2', customerId: 'customer-1', customerName: 'Alpha', customerCode: 'ALPHA', modelId: 'model-1', modelName: 'Switch 48', vendorId: 'vendor-1', vendorName: 'Vendor A', currentId: 'release-old', currentVersion: '0.9' }),
      device({ id: 'device-3', customerId: 'customer-2', customerName: 'Beta', modelId: 'model-2', modelName: 'Firewall X', vendorId: 'vendor-2', vendorName: 'Vendor B', currentId: null, workflow: 'IGNORED' }),
      device({ id: 'device-4', customerId: 'customer-2', customerName: 'Beta', modelId: 'model-3', modelName: 'AP 10', vendorId: 'vendor-2', vendorName: 'Vendor B', currentId: 'release-3', currentVersion: '3.0', workflow: 'CUSTOMER_DECLINED' }),
      device({ id: 'device-5', customerId: 'customer-3', customerName: 'Gamma', modelId: 'model-2', modelName: 'Firewall X', vendorId: 'vendor-2', vendorName: 'Vendor B', currentId: 'release-2', currentVersion: '2.0', workflow: 'DONE' }),
      device({ id: 'device-archived', customerId: 'customer-1', customerName: 'Alpha', modelId: 'model-4', modelName: 'Old switch', vendorId: 'vendor-1', vendorName: 'Vendor A', currentId: 'release-old', active: false }),
    ])
    mocks.auditFindMany.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'FIRMWARE_LIFECYCLE_DONE',
        entityId: 'device-5',
        after: { state: 'DONE', notes: 'Upgrade completed.' },
        createdAt: new Date('2026-09-01T10:00:00Z'),
        actor: { name: 'Engineer' },
        customer: { id: 'customer-3', name: 'Gamma' },
      },
    ])

    const result = await getFirmwareLifecycleDashboard()

    expect(result.inventory).toEqual({ customers: 3, devices: 5, models: 3, vendors: 2 })
    expect(result.technical).toEqual({ current: 2, actionRequired: 1, unknown: 1, noPolicy: 1 })
    expect(result.workflow).toEqual({ planned: 1, ignored: 1, customerDeclined: 1, done: 1, undecided: 1 })

    expect(result.modelsRequiringUpdates).toEqual([
      expect.objectContaining({ id: 'model-1', actionRequired: 1, devices: 2 }),
    ])
    expect(result.customersRequiringUpdates).toEqual([
      expect.objectContaining({ id: 'customer-1', actionRequired: 1, devices: 2 }),
    ])
    expect(result.complianceByVendor).toEqual([
      expect.objectContaining({ id: 'vendor-1', devices: 2, current: 1, actionRequired: 1 }),
      expect.objectContaining({ id: 'vendor-2', devices: 3, current: 1, unknown: 1, noPolicy: 1 }),
    ])
    expect(result.currentFirmwareDistribution.find((release) => release.id === 'release-1')).toEqual(
      expect.objectContaining({ version: '1.0', devices: 1 }),
    )
    expect(result.recentDecisions[0]).toEqual(
      expect.objectContaining({
        state: 'DONE',
        deviceId: 'device-5',
        deviceName: 'DEVICE-5',
        customerName: 'Gamma',
        actorName: 'Engineer',
        notes: 'Upgrade completed.',
      }),
    )

    expect(mocks.policyFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.policyFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deviceModelId: { in: expect.arrayContaining(['model-1', 'model-2', 'model-3']) },
      }),
    }))
    const modelIds = mocks.policyFindMany.mock.calls[0][0].where.deviceModelId.in
    expect(modelIds).not.toContain('model-4')
  })

  it('returns a useful zero state without querying desired policies', async () => {
    mocks.listDevices.mockResolvedValue([])
    mocks.customerCount.mockResolvedValue(0)
    mocks.modelCount.mockResolvedValue(0)
    mocks.vendorCount.mockResolvedValue(0)

    const result = await getFirmwareLifecycleDashboard()

    expect(result.inventory).toEqual({ customers: 0, devices: 0, models: 0, vendors: 0 })
    expect(result.technical).toEqual({ current: 0, actionRequired: 0, unknown: 0, noPolicy: 0 })
    expect(result.workflow).toEqual({ planned: 0, ignored: 0, customerDeclined: 0, done: 0, undecided: 0 })
    expect(result.modelsRequiringUpdates).toEqual([])
    expect(result.customersRequiringUpdates).toEqual([])
    expect(result.complianceByVendor).toEqual([])
    expect(mocks.policyFindMany).not.toHaveBeenCalled()
  })
})
