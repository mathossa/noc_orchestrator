import {
  resolveFirmwareCompliance,
  type ComplianceRelease,
  type FirmwareComplianceInput,
  type FirmwareComplianceResult,
} from '../firmware-compliance'
import type { FirmwarePolicyCandidate } from '../firmware-policies'

export function release(
  version = '17.15.5',
  overrides: Partial<ComplianceRelease> = {},
): ComplianceRelease {
  return {
    id: version,
    vendorId: 'synthetic-vendor',
    platform: 'IOS XE',
    firmwareTrainId: 'train',
    logicalVersion: version,
    version,
    variant: null,
    imageCode: null,
    isActive: true,
    catalogState: 'VERIFIED',
    policyEligibility: 'ALLOWED',
    variantEquivalence: 'EXACT_ONLY',
    status: 'APPROVED',
    firmwareTrain: { id: 'train', name: 'Synthetic train' },
    ...overrides,
  }
}
export function policy(
  overrides: Partial<FirmwarePolicyCandidate> = {},
): FirmwarePolicyCandidate {
  return {
    id: 'policy',
    isActive: true,
    policyMode: 'MINIMUM',
    trackKey: 'default',
    trackName: 'Preferred',
    trackClass: 'PREFERRED',
    isDefaultTrack: true,
    desiredPlatform: 'IOS XE',
    minimumFirmwareReleaseId: '17.12.5',
    targetFirmwareReleaseId: '17.15.5',
    maximumFirmwareReleaseId: null,
    firmwareTrainId: null,
    minimumInclusive: true,
    maximumInclusive: true,
    effectiveFrom: '2026-01-01T00:00:00Z',
    policyVersion: 1,
    deviceModelId: 'model',
    deviceModelFamilyId: null,
    customerId: null,
    siteId: null,
    deviceId: null,
    ...overrides,
  }
}
export function input(
  version = '17.15.5',
  overrides: Partial<FirmwareComplianceInput> = {},
): FirmwareComplianceInput {
  const preferred = release()
  return {
    currentFirmware: release(version),
    effectivePolicy: {
      status: 'RESOLVED',
      policy: policy(),
      source: null,
      unresolvedReason: null,
    },
    preferredTarget: preferred,
    minimum: release('17.12.5'),
    maximum: null,
    currentCompatibility: {
      status: 'COMPATIBLE',
      decision: 'ALLOW',
      matchedRuleIds: ['rule'],
      provenance: {
        kind: 'MODEL_RULE',
        id: 'rule',
        sourceType: 'CATALOG',
        explanation: 'Synthetic compatible model',
        inherited: false,
      },
    },
    targetCompatibility: {
      status: 'RESOLVED',
      release: preferred,
      compatibleCandidates: [preferred],
      unknownCandidates: [],
      incompatibleCandidates: [],
      explanation: 'Synthetic exact image resolved',
    },
    resolvedTarget: preferred,
    ...overrides,
  }
}
/** Consumer tests supply precomputed domain results; they do not duplicate policy rules. */
export function result(
  overrides: Partial<FirmwareComplianceResult> = {},
): FirmwareComplianceResult {
  return { ...resolveFirmwareCompliance(input()), ...overrides }
}
