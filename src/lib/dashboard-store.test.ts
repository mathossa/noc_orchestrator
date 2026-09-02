import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceContractReference, DeviceRecord } from '@/lib/devices'

const mocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  policyFindMany: vi.fn(),
}))

vi.mock('@/lib/device-store', () => ({ listDevices: mocks.listDevices }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    firmwarePolicy: { findMany: mocks.policyFindMany },
  },
}))

import { getFirmwareLifecycleDashboard } from '@/lib/dashboard-store'

function contract(id: string, name: string): DeviceContractReference {
  return { id, code: id.toUpperCase(), name, firmwareManagementEnabled: true, isActive: true }
}

function device({
  id,
  customerId,
  customerName,
  customerContract = null,
  siteId = null,
  siteName,
  siteContract = null,
  modelId,
  modelName,
  vendorId,
  vendorName,
  currentId,
  currentVersion,
  currentStatus = 'APPROVED',
  workflow,
  active = true,
}: {
  id: string
  customerId: string
  customerName: string
  customerContract?: DeviceContractReference | null
  siteId?: string | null
  siteName?: string
  siteContract?: DeviceContractReference | null
  modelId: string
  modelName: string
  vendorId: string
  vendorName: string
  currentId: string | null
  currentVersion?: string
  currentStatus?: string
  workflow?: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
  active?: boolean
}): DeviceRecord {
  const effectiveContractType = siteContract ?? customerContract
  return {
    id,
    customerId,
    siteId,
    deviceModelId: modelId,
    platform: 'NOS',
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
      code: null,
      name: customerName,
      isActive: true,
      contractType: customerContract,
    },
    site: siteId
      ? {
          id: siteId,
          code: null,
          name: siteName ?? siteId,
          isActive: true,
          contractType: siteContract,
        }
      : null,
    effectiveContractType,
    contractSource: siteContract ? 'SITE' : customerContract ? 'CUSTOMER' : 'NONE',
    deviceModel: {
      id: modelId,
      model: modelName,
      platform: 'NOS',
      supportedPlatforms: [{ id: 'model-platform-nos', platform: 'NOS' }],
      isActive: true,
      vendor: { id: vendorId, code: vendorId.toUpperCase(), name: vendorName, isActive: true },
      deviceType: { id: 'type-switch', code: 'SWITCH', name: 'Switches', isActive: true },
    },
    currentFirmwareRelease: currentId
      ? {
          id: currentId,
          vendorId,
          platform: 'NOS',
          version: currentVersion ?? currentId,
          status: currentStatus,
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
    mocks.policyFindMany.mockResolvedValue([
      { deviceModelId: 'model-1', targetFirmwareReleaseId: 'release-1' },
      { deviceModelId: 'model-2', targetFirmwareReleaseId: 'release-2' },
    ])
  })

  it('prioritizes customer/site, effective contract, vendor, and bad-release attention without conflating workflow', async () => {
    const gold = contract('contract-gold', 'Gold')
    const premium = contract('contract-premium', 'Premium')
    const standard = contract('contract-standard', 'Standard')

    mocks.listDevices.mockResolvedValue([
      device({
        id: 'device-1',
        customerId: 'customer-1',
        customerName: 'Alpha',
        customerContract: gold,
        siteId: 'site-1',
        siteName: 'Amsterdam',
        modelId: 'model-1',
        modelName: 'Switch 48',
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        currentId: 'release-old',
        currentVersion: '0.9',
        workflow: 'PLANNED',
      }),
      device({
        id: 'device-2',
        customerId: 'customer-1',
        customerName: 'Alpha',
        customerContract: gold,
        siteId: 'site-2',
        siteName: 'Rotterdam',
        siteContract: premium,
        modelId: 'model-2',
        modelName: 'Firewall X',
        vendorId: 'vendor-b',
        vendorName: 'Vendor B',
        currentId: null,
        workflow: 'IGNORED',
      }),
      device({
        id: 'device-3',
        customerId: 'customer-2',
        customerName: 'Beta',
        modelId: 'model-3',
        modelName: 'AP 10',
        vendorId: 'vendor-b',
        vendorName: 'Vendor B',
        currentId: 'release-blocked',
        currentVersion: 'BAD-1',
        currentStatus: 'BLOCKED',
      }),
      device({
        id: 'device-4',
        customerId: 'customer-2',
        customerName: 'Beta',
        customerContract: standard,
        siteId: 'site-3',
        siteName: 'Utrecht',
        modelId: 'model-1',
        modelName: 'Switch 48',
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        currentId: 'release-1',
        currentVersion: '1.0',
        workflow: 'DONE',
      }),
      device({
        id: 'device-archived',
        customerId: 'customer-1',
        customerName: 'Alpha',
        customerContract: gold,
        modelId: 'model-1',
        modelName: 'Old switch',
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        currentId: 'release-old',
        active: false,
      }),
    ])

    const result = await getFirmwareLifecycleDashboard()

    expect(result.activeDevices).toBe(4)
    expect(result.technical).toEqual({ current: 1, actionRequired: 1, unknown: 1, noPolicy: 1 })
    expect(result.workflow).toEqual({ planned: 1, ignored: 1, customerDeclined: 0, done: 1, undecided: 1 })

    expect(result.customerAttention[0]).toEqual(
      expect.objectContaining({ id: 'customer-1', actionRequired: 1, unknown: 1, noPolicy: 0 }),
    )
    expect(result.customerAttention[0].sites).toEqual([
      expect.objectContaining({ id: 'site-1', name: 'Amsterdam', actionRequired: 1 }),
      expect.objectContaining({ id: 'site-2', name: 'Rotterdam', unknown: 1 }),
    ])
    expect(result.customerAttention).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'customer-2', noPolicy: 1 })]),
    )

    expect(result.contractAttention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'contract-gold', actionRequired: 1, unknown: 0 }),
        expect.objectContaining({ id: 'contract-premium', actionRequired: 0, unknown: 1 }),
        expect.objectContaining({ id: null, name: 'No contract', noPolicy: 1, blocked: 1 }),
      ]),
    )
    expect(result.contractAttention.find((row) => row.id === 'contract-gold')?.devices).toBe(1)
    expect(result.contractAttention.find((row) => row.id === 'contract-premium')?.devices).toBe(1)
    expect(result.contractAttention.find((row) => row.id === 'contract-standard')).toBeUndefined()

    expect(result.vendorAttention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'vendor-a', actionRequired: 1 }),
        expect.objectContaining({ id: 'vendor-b', unknown: 1, noPolicy: 1, blocked: 1 }),
      ]),
    )

    expect(result.firmwareAttention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'release-old', actionRequired: 1, blocked: 0 }),
        expect.objectContaining({ id: 'release-blocked', actionRequired: 0, blocked: 1, status: 'BLOCKED' }),
      ]),
    )
    expect(result.firmwareAttention.find((release) => release.id === 'release-1')).toBeUndefined()

    expect(mocks.policyFindMany).toHaveBeenCalledTimes(1)
    const modelIds = mocks.policyFindMany.mock.calls[0][0].where.deviceModelId.in
    expect(modelIds).toEqual(expect.arrayContaining(['model-1', 'model-2', 'model-3']))
    expect(modelIds).not.toContain('model-4')
  })

  it('returns a useful zero state without querying desired policies', async () => {
    mocks.listDevices.mockResolvedValue([])

    const result = await getFirmwareLifecycleDashboard()

    expect(result.activeDevices).toBe(0)
    expect(result.technical).toEqual({ current: 0, actionRequired: 0, unknown: 0, noPolicy: 0 })
    expect(result.workflow).toEqual({ planned: 0, ignored: 0, customerDeclined: 0, done: 0, undecided: 0 })
    expect(result.customerAttention).toEqual([])
    expect(result.contractAttention).toEqual([])
    expect(result.vendorAttention).toEqual([])
    expect(result.firmwareAttention).toEqual([])
    expect(mocks.policyFindMany).not.toHaveBeenCalled()
  })
})
