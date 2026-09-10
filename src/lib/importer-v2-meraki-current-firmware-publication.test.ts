import { describe, expect, it } from 'vitest'
import { importerV2ObservedFirmwareVerificationDecision } from '@/lib/importer-v2-firmware-verification-policy'
import { importerV2CurrentFirmwareReleaseId } from '@/lib/importer-v2-publication-firmware'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'

describe('Importer v2 Meraki current-firmware publication regression', () => {
  it('carries MR 32.2.4 from staged evidence through verification into a canonical current-firmware link', () => {
    const evaluated = {
      rawValues: {
        vendor: 'Cisco',
        model: 'Meraki CW9162I',
        softwareVersion: 'MR 32.2.4',
      },
      proposedCanonicalValues: {
        vendor: { id: 'vendor-cisco', label: 'Cisco' },
        model: { id: 'model-cw9162i', label: 'Meraki CW9162I' },
        currentFirmware: { id: null, label: 'MR 32.2.4' },
        softwarePlatform: { id: null, label: 'Meraki MR' },
      },
      fields: {},
      issues: [],
      firmware: {
        runningVersion: 'MR 32.2.4',
        proposedSoftwarePlatform: 'Meraki MR',
        compatibility: {
          status: 'UNKNOWN',
          ruleId: null,
          allowedPlatforms: [],
          explanation: 'No model-platform compatibility rule exists yet.',
        },
        warnings: [],
      },
    }

    const verification = importerV2ObservedFirmwareVerificationDecision(evaluated)
    expect(verification.status).toBe('VERIFY')
    if (verification.status !== 'VERIFY') throw new Error('Expected verification')

    const decisions = [
      {
        field: 'currentFirmware',
        action: 'VERIFY_OBSERVED_FIRMWARE',
        value: verification.value,
        explanation: 'Engineer verified observed current firmware.',
      },
    ]

    const effective = importerV2WorkspaceEffectiveEvaluated({
      evaluated,
      inclusion: 'INCLUDED',
      decisions,
    }).evaluated

    expect(effective.proposedCanonicalValues?.currentFirmware?.label).toBe('MR 32.2.4')
    expect(effective.proposedCanonicalValues?.softwarePlatform?.label).toBe('Meraki MR')
    expect(effective.firmware?.runningVersion).toBe('MR 32.2.4')
    expect(effective.firmware?.proposedSoftwarePlatform).toBe('Meraki MR')
    expect(effective.firmware?.compatibility?.status).toBe('COMPATIBLE')

    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: 'release-mr-32-2-4',
        runningVersion: effective.proposedCanonicalValues?.currentFirmware?.label,
        softwarePlatform: effective.proposedCanonicalValues?.softwarePlatform?.label,
        compatibilityStatus: effective.firmware?.compatibility?.status,
        decisions,
      }),
    ).toBe('release-mr-32-2-4')
  })

  it('refuses to let the same verified Meraki observation publish without a canonical release', () => {
    const decisions = [
      {
        field: 'currentFirmware',
        action: 'VERIFY_OBSERVED_FIRMWARE',
        value: {
          runningVersion: 'MR 32.2.4',
          softwarePlatform: 'Meraki MR',
          originalCompatibilityStatus: 'UNKNOWN',
          verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY' as const,
        },
      },
    ]

    expect(() =>
      importerV2CurrentFirmwareReleaseId({
        releaseId: null,
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'UNKNOWN',
        decisions,
      }),
    ).toThrow('Publication was stopped to prevent Current firmware from becoming Unknown')
  })
})
