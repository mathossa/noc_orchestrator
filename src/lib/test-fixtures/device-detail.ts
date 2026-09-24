import type { DeviceDetailRecord } from '../devices'
import { result, release } from './firmware-compliance'
import { deriveInventoryPrimaryStatus } from '../inventory-status'

export function deviceDetailFixture(
  overrides: Partial<DeviceDetailRecord> = {},
): DeviceDetailRecord {
  const firmwareCompliance =
    overrides.firmwareCompliance ??
    result({ compliance: 'PREFERRED', recommendation: 'NO_ACTION' })
  const exceptionSummary = overrides.exceptionSummary ?? {
    state: 'NONE',
    effective: null,
    activeCount: 0,
    inheritedCount: 0,
    historyCount: 0,
    reviewDueAt: null,
  }
  return {
    id: 'device',
    name: 'HQ-AP001',
    customerId: 'customer',
    siteId: 'site',
    deviceModelId: 'model',
    hostname: null,
    serialNumber: 'SERIAL-1',
    managementAddress: '10.0.0.1',
    notes: null,
    issueReason: null,
    issueFlaggedAt: null,
    topology: null,
    planning: { activePlans: [], history: [] },
    currentFirmwareReleaseId: '17.15.5',
    currentFirmwareObservedAt: '2026-09-22T12:00:00Z',
    currentFirmwareAgeDays: 1,
    currentFirmwareSource: 'IMPORT',
    currentFirmwareRawVersion: '17.15.5',
    currentFirmwareNormalizedVersion: '17.15.5',
    currentFirmwareInterpreterId: null,
    currentFirmwareInterpreterVersion: null,
    isActive: true,
    source: 'IMPORT',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    customer: {
      id: 'customer',
      code: null,
      name: 'Customer',
      isActive: true,
      contractType: null,
    },
    site: {
      id: 'site',
      code: 'HQ',
      name: 'HQ',
      isActive: true,
      contractType: null,
    },
    effectiveContractType: null,
    contractSource: 'NONE',
    deviceModel: {
      id: 'model',
      model: 'AP-505',
      supportedPlatforms: ['IOS XE'],
      isActive: true,
      vendor: { id: 'vendor', code: 'VENDOR', name: 'Vendor', isActive: true },
      deviceType: {
        id: 'ap',
        code: 'AP',
        name: 'Access Point',
        isActive: true,
      },
    },
    currentFirmwareRelease: { ...release(), releasedAt: null },
    lifecycle: null,
    firmwareCompliance,
    exceptionSummary,
    inventoryStatus: deriveInventoryPrimaryStatus(
      firmwareCompliance,
      exceptionSummary,
    ),
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-22T12:00:00Z',
    desiredFirmware: { available: true, release: release() },
    technicalState: { available: true, state: 'CURRENT' },
    auditHistory: [],
    ...overrides,
  }
}
