import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindUnique: vi.fn(),
  modelFindUnique: vi.fn(),
  firmwareFindUnique: vi.fn(),
  deviceFindMany: vi.fn(),
  deviceFindUnique: vi.fn(),
  deviceCreate: vi.fn(),
  deviceUpdate: vi.fn(),
  deviceDelete: vi.fn(),
  policyFindFirst: vi.fn(),
  policyCount: vi.fn(),
  lifecycleCount: vi.fn(),
  auditFindMany: vi.fn(),
  auditCreate: vi.fn(),
  auditCount: vi.fn(),
  transaction: vi.fn(),
  assertSiteBelongsToCustomer: vi.fn(),
  compatibilityCheck: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: { findUnique: mocks.customerFindUnique, findMany: vi.fn() },
    site: { findMany: vi.fn() },
    deviceModel: { findUnique: mocks.modelFindUnique, findMany: vi.fn() },
    firmwareRelease: { findUnique: mocks.firmwareFindUnique, findMany: vi.fn() },
    device: {
      findMany: mocks.deviceFindMany,
      findUnique: mocks.deviceFindUnique,
      create: mocks.deviceCreate,
      update: mocks.deviceUpdate,
      delete: mocks.deviceDelete,
    },
    firmwarePolicy: { findFirst: mocks.policyFindFirst, count: mocks.policyCount },
    firmwareLifecycleRecord: { count: mocks.lifecycleCount },
    auditEvent: { findMany: mocks.auditFindMany, create: mocks.auditCreate, count: mocks.auditCount },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/site-store', () => ({
  SiteCustomerError: class SiteCustomerError extends Error {},
  assertSiteBelongsToCustomer: mocks.assertSiteBelongsToCustomer,
}))

vi.mock('@/lib/firmware-compatibility-store', () => ({
  evaluateModelFirmwareCompatibility: mocks.compatibilityCheck,
}))

import {
  createDevice,
  deleteDevice,
  DeviceConflictError,
  DeviceInUseError,
  DeviceReferenceError,
  getDevice,
  updateDevice,
} from '@/lib/device-store'

const customerContract = {
  id: 'contract-1',
  code: 'FULL',
  name: 'Fully Managed',
  firmwareManagementEnabled: true,
  isActive: true,
}
const siteContract = {
  id: 'contract-2',
  code: 'FW',
  name: 'Firmware Management',
  firmwareManagementEnabled: true,
  isActive: true,
}
const customer = {
  id: 'customer-1',
  code: 'ACME',
  name: 'Acme',
  isActive: true,
  contractType: customerContract,
}
const model = {
  id: 'model-1',
  model: 'C9300-24P',
  platform: 'IOS XE',
  isActive: true,
  vendor: { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true },
  deviceType: { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true },
}
const rawModel = { id: 'model-1', vendorId: 'vendor-1' }
const release = {
  id: 'release-1',
  vendorId: 'vendor-1',
  platform: 'IOS XE',
  version: '17.12.5',
  status: 'APPROVED',
  isActive: true,
  releasedAt: new Date('2026-08-01T00:00:00Z'),
  firmwareTrain: { id: 'train-old', name: '17.12.x' },
}
const storedDevice = {
  id: 'device-1',
  customerId: 'customer-1',
  siteId: null,
  deviceModelId: 'model-1',
  name: 'HQ-SW-01',
  hostname: null,
  serialNumber: null,
  managementAddress: null,
  notes: null,
  currentFirmwareReleaseId: null,
  currentFirmwareObservedAt: null,
  currentFirmwareSource: 'MANUAL',
  currentFirmwareRawVersion: null,
  currentFirmwareNormalizedVersion: null,
  currentFirmwareInterpreterId: null,
  currentFirmwareInterpreterVersion: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  customer,
  site: null,
  deviceModel: model,
  currentFirmwareRelease: null,
  lifecycle: null,
  createdAt: new Date('2026-08-31T20:00:00Z'),
  updatedAt: new Date('2026-08-31T20:00:00Z'),
}

const desiredRelease = {
  id: 'desired-1',
  vendorId: 'vendor-1',
  platform: 'IOS XE',
  version: '17.15.5',
  logicalVersion: '17.15.5',
  variant: null,
  imageCode: null,
  catalogState: 'VERIFIED',
  policyEligibility: 'ALLOWED',
  variantEquivalence: 'EXACT_ONLY',
  status: 'APPROVED',
  isActive: true,
  releasedAt: new Date('2026-08-20T00:00:00Z'),
  firmwareTrain: { id: 'train-new', name: '17.15.x' },
}

function desiredPolicy(target = desiredRelease) {
  const timestamp = new Date('2026-09-01T00:00:00Z')
  return {
    id: 'policy-1',
    policyMode: 'EXACT',
    trackKey: 'default',
    trackName: 'Default',
    trackClass: 'PREFERRED',
    isDefaultTrack: true,
    desiredPlatform: target.platform,
    minimumFirmwareReleaseId: null,
    targetFirmwareReleaseId: target.id,
    maximumFirmwareReleaseId: null,
    firmwareTrainId: null,
    minimumInclusive: true,
    maximumInclusive: true,
    effectiveFrom: timestamp,
    policyVersion: 1,
    isActive: true,
    notes: null,
    deviceModelFamilyId: null,
    deviceModelId: 'model-1',
    customerId: null,
    siteId: null,
    deviceId: null,
    contractTypeId: null,
    vendorId: null,
    deviceTypeId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    minimumFirmwareRelease: null,
    targetFirmwareRelease: target,
    maximumFirmwareRelease: null,
    firmwareTrain: null,
  }
}

describe('device inventory persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1' })
    mocks.modelFindUnique.mockResolvedValue(rawModel)
    mocks.deviceFindMany.mockResolvedValue([])
    mocks.policyFindFirst.mockResolvedValue(null)
    mocks.auditFindMany.mockResolvedValue([])
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.assertSiteBelongsToCustomer.mockResolvedValue(null)
    mocks.compatibilityCheck.mockResolvedValue({
      status: 'COMPATIBLE',
      decision: 'ALLOW',
      provenance: { kind: 'MODEL_RULE', id: 'rule-1', sourceType: 'CATALOG', explanation: 'Supported.', inherited: false },
      matchedRuleIds: ['rule-1'],
    })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      device: { create: mocks.deviceCreate, update: mocks.deviceUpdate },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('creates a minimal manual device without site or external identity', async () => {
    mocks.deviceCreate.mockResolvedValue(storedDevice)
    const result = await createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01' })
    expect(result).toMatchObject({ id: 'device-1', source: 'MANUAL', currentFirmwareRelease: null, effectiveContractType: customerContract, contractSource: 'CUSTOMER' })
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('validates optional site assignment against the selected customer', async () => {
    mocks.deviceCreate.mockResolvedValue({ ...storedDevice, siteId: 'site-1', site: { id: 'site-1', code: 'BRANCH', name: 'Branch', isActive: true, contractType: null } })
    await createDevice({ customerId: 'customer-1', siteId: 'site-1', deviceModelId: 'model-1', name: 'HQ-SW-01' })
    expect(mocks.assertSiteBelongsToCustomer).toHaveBeenCalledWith('site-1', 'customer-1')
  })

  it('uses a site contract override before the customer default', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, siteId: 'site-1', site: { id: 'site-1', code: 'BRANCH', name: 'Branch', isActive: true, contractType: siteContract } })
    const result = await getDevice('device-1')
    expect(result.effectiveContractType).toEqual(siteContract)
    expect(result.contractSource).toBe('SITE')
    expect(result.auditHistory).toEqual([])
  })

  it('rejects current firmware from a different vendor before compatibility evaluation', async () => {
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'release-other', vendorId: 'vendor-2' })
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01', currentFirmwareReleaseId: 'release-other' })).rejects.toBeInstanceOf(DeviceReferenceError)
    expect(mocks.compatibilityCheck).not.toHaveBeenCalled()
  })

  it('allows a cross-platform canonical link only when compatibility is explicitly proven', async () => {
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'release-other', vendorId: 'vendor-1' })
    mocks.deviceCreate.mockResolvedValue({ ...storedDevice, currentFirmwareReleaseId: 'release-other', currentFirmwareRelease: { ...release, id: 'release-other', platform: 'OTHER' } })
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01', currentFirmwareReleaseId: 'release-other' })).resolves.toBeDefined()
    expect(mocks.compatibilityCheck).toHaveBeenCalledWith('model-1', 'release-other')
  })

  it('rejects UNKNOWN or INCOMPATIBLE canonical links and explains preserving raw evidence', async () => {
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'release-other', vendorId: 'vendor-1' })
    for (const status of ['UNKNOWN', 'INCOMPATIBLE'] as const) {
      mocks.compatibilityCheck.mockResolvedValueOnce({
        status,
        decision: status === 'INCOMPATIBLE' ? 'DENY' : null,
        provenance: { kind: 'NO_EVIDENCE', id: null, sourceType: 'SYSTEM', explanation: 'No proven mapping.', inherited: false },
        matchedRuleIds: [],
      })
      await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01', currentFirmwareReleaseId: 'release-other' })).rejects.toThrow(/Preserve the raw reported version/)
    }
  })

  it('preserves a raw incompatible report without forcing a canonical release link', async () => {
    const observedAt = new Date('2026-09-04T12:00:00Z')
    const rawOnly = {
      ...storedDevice,
      currentFirmwareObservedAt: observedAt,
      currentFirmwareSource: 'IMPORT',
      currentFirmwareRawVersion: 'mystery-build-1',
      currentFirmwareNormalizedVersion: 'mystery-build-1',
      currentFirmwareInterpreterId: 'importer-v2-firmware-interpreter',
      currentFirmwareInterpreterVersion: '1.0.0',
    }
    mocks.deviceCreate.mockResolvedValue(rawOnly)
    const result = await createDevice({
      customerId: 'customer-1',
      deviceModelId: 'model-1',
      name: 'HQ-SW-01',
      currentFirmwareReleaseId: null,
      currentFirmwareRawVersion: 'mystery-build-1',
      currentFirmwareNormalizedVersion: 'mystery-build-1',
      currentFirmwareObservedAt: observedAt.toISOString(),
      currentFirmwareSource: 'IMPORT',
      currentFirmwareInterpreterId: 'importer-v2-firmware-interpreter',
      currentFirmwareInterpreterVersion: '1.0.0',
    })
    expect(result).toMatchObject({
      currentFirmwareReleaseId: null,
      currentFirmwareRawVersion: 'mystery-build-1',
      currentFirmwareObservedAt: observedAt.toISOString(),
      currentFirmwareSource: 'IMPORT',
    })
    expect(mocks.compatibilityCheck).not.toHaveBeenCalled()
  })

  it('rejects normalized duplicate device names within one customer', async () => {
    mocks.deviceFindMany.mockResolvedValue([{ id: 'existing', name: '  hq-sw-01 ' }])
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01' })).rejects.toBeInstanceOf(DeviceConflictError)
  })

  it('supports archive-only updates without creating irrelevant audit noise', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, customer: undefined, site: undefined, deviceModel: undefined, currentFirmwareRelease: null, lifecycle: undefined })
    mocks.deviceUpdate.mockResolvedValue({ ...storedDevice, isActive: false })
    await updateDevice('device-1', { isActive: false })
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('audits a manual current-firmware change with previous/new values and actor', async () => {
    const newerRelease = { ...release, id: 'release-2', version: '17.15.5', firmwareTrain: { id: 'train-new', name: '17.15.x' } }
    const oldObservedAt = new Date('2026-08-30T20:00:00Z')
    const newObservedAt = new Date('2026-09-01T00:15:00Z')
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, currentFirmwareReleaseId: release.id, currentFirmwareObservedAt: oldObservedAt, currentFirmwareRelease: { id: release.id, version: release.version, platform: release.platform } })
    mocks.firmwareFindUnique.mockResolvedValue({ id: newerRelease.id, vendorId: 'vendor-1' })
    mocks.deviceUpdate.mockResolvedValue({ ...storedDevice, currentFirmwareReleaseId: newerRelease.id, currentFirmwareObservedAt: newObservedAt, currentFirmwareRelease: newerRelease })

    await updateDevice('device-1', { currentFirmwareReleaseId: newerRelease.id, currentFirmwareObservedAt: newObservedAt.toISOString(), currentFirmwareSource: 'MANUAL' }, 'user-1')
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: 'user-1', action: 'CURRENT_FIRMWARE_CHANGED', before: expect.objectContaining({ firmwareReleaseId: 'release-1' }), after: expect.objectContaining({ firmwareReleaseId: 'release-2' }) }) }))
  })

  it('resolves ACTION_REQUIRED when current and desired exact releases differ', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, currentFirmwareReleaseId: 'release-1', currentFirmwareRelease: release, currentFirmwareObservedAt: new Date('2026-08-30T20:00:00Z') })
    mocks.policyFindFirst.mockResolvedValue(desiredPolicy())
    const result = await getDevice('device-1')
    expect(result.currentFirmwareRelease?.version).toBe('17.12.5')
    expect(result.desiredFirmware.release?.version).toBe('17.15.5')
    expect(result.technicalState).toEqual({ available: true, state: 'ACTION_REQUIRED' })
  })

  it('resolves CURRENT when the exact current release is the desired release', async () => {
    const desiredCurrent = { ...desiredRelease, id: release.id, version: release.version, logicalVersion: release.version, platform: release.platform, releasedAt: release.releasedAt, firmwareTrain: release.firmwareTrain }
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, currentFirmwareReleaseId: 'release-1', currentFirmwareRelease: release })
    mocks.policyFindFirst.mockResolvedValue(desiredPolicy(desiredCurrent))
    const result = await getDevice('device-1')
    expect(result.technicalState).toEqual({ available: true, state: 'CURRENT' })
  })

  it('resolves UNKNOWN when a desired exact policy exists but current firmware is not recorded', async () => {
    mocks.deviceFindUnique.mockResolvedValue(storedDevice)
    mocks.policyFindFirst.mockResolvedValue(desiredPolicy())
    const result = await getDevice('device-1')
    expect(result.technicalState).toEqual({ available: true, state: 'UNKNOWN' })
  })

  it('does not crash when a policy mode has no exact target; compliance remains deferred to #58', async () => {
    const moving = { ...desiredPolicy(), policyMode: 'LATEST_APPROVED_IN_TRAIN', targetFirmwareReleaseId: null, targetFirmwareRelease: null, firmwareTrainId: 'train-new', firmwareTrain: { id: 'train-new', vendorId: 'vendor-1', platform: 'IOS XE', name: '17.15.x', isActive: true } }
    mocks.deviceFindUnique.mockResolvedValue(storedDevice)
    mocks.policyFindFirst.mockResolvedValue(moving)
    const result = await getDevice('device-1')
    expect(result.desiredFirmware).toEqual({ available: true, release: null })
    expect(result.technicalState).toEqual({ available: true, state: 'NO_POLICY' })
  })

  it('resolves NO_POLICY when the model has no active desired policy', async () => {
    mocks.deviceFindUnique.mockResolvedValue(storedDevice)
    const result = await getDevice('device-1')
    expect(result.desiredFirmware).toEqual({ available: true, release: null })
    expect(result.technicalState).toEqual({ available: true, state: 'NO_POLICY' })
  })

  it('blocks destructive deletion when lifecycle or history references exist', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ id: 'device-1', name: 'HQ-SW-01' })
    mocks.policyCount.mockResolvedValue(0)
    mocks.lifecycleCount.mockResolvedValue(1)
    mocks.auditCount.mockResolvedValue(0)
    await expect(deleteDevice('device-1')).rejects.toBeInstanceOf(DeviceInUseError)
    expect(mocks.deviceDelete).not.toHaveBeenCalled()
  })
})
