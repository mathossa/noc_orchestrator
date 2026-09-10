import { describe, expect, it } from 'vitest'
import {
  importerV2CurrentFirmwareReleaseId,
  importerV2ShouldReplaceCurrentFirmware,
} from '@/lib/importer-v2-publication-firmware'

describe('Importer v2 current firmware publication ownership', () => {
  it('preserves an existing canonical current firmware when the source reports no running version', () => {
    expect(
      importerV2ShouldReplaceCurrentFirmware({
        runningVersion: null,
        decisions: [],
      }),
    ).toBe(false)
  })

  it('replaces current firmware when a concrete observed running version exists', () => {
    expect(
      importerV2ShouldReplaceCurrentFirmware({
        runningVersion: 'MR 32.2.4',
        decisions: [],
      }),
    ).toBe(true)
  })

  it('honors an explicit operator clear even when no running version exists', () => {
    expect(
      importerV2ShouldReplaceCurrentFirmware({
        runningVersion: null,
        decisions: [{ field: 'currentFirmware', action: 'CLEAR_FIELD' }],
      }),
    ).toBe(true)
  })

  it('links a compatible observed release without additional verification', () => {
    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: 'release-mr-32-2-4',
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'COMPATIBLE',
        decisions: [],
      }),
    ).toBe('release-mr-32-2-4')
  })

  it('links the exact unknown-compatibility release after observation-only engineer verification', () => {
    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: 'release-mr-32-2-4',
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'UNKNOWN',
        decisions: [
          {
            action: 'VERIFY_OBSERVED_FIRMWARE',
            value: {
              runningVersion: 'MR 32.2.4',
              softwarePlatform: 'Meraki MR',
              originalCompatibilityStatus: 'UNKNOWN',
              verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
            },
          },
        ],
      }),
    ).toBe('release-mr-32-2-4')
  })

  it('does not let a stale firmware verification link a different release or platform', () => {
    const decisions = [
      {
        action: 'VERIFY_OBSERVED_FIRMWARE',
        value: {
          runningVersion: 'MR 32.2.4',
          softwarePlatform: 'Meraki MR',
          originalCompatibilityStatus: 'UNKNOWN',
          verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
        },
      },
    ]

    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: 'release-mr-32-3',
        runningVersion: 'MR 32.3',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'UNKNOWN',
        decisions,
      }),
    ).toBeNull()

    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: 'release-ms-32-2-4',
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MS',
        compatibilityStatus: 'UNKNOWN',
        decisions,
      }),
    ).toBeNull()
  })

  it('never bypasses an explicitly incompatible model/release result', () => {
    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: 'release-mr-32-2-4',
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'INCOMPATIBLE',
        decisions: [
          {
            action: 'VERIFY_OBSERVED_FIRMWARE',
            value: {
              runningVersion: 'MR 32.2.4',
              softwarePlatform: 'Meraki MR',
              originalCompatibilityStatus: 'INCOMPATIBLE',
              verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
            },
          },
        ],
      }),
    ).toBeNull()
  })

  it('fails publication instead of silently losing a compatible current-firmware link', () => {
    expect(() =>
      importerV2CurrentFirmwareReleaseId({
        releaseId: null,
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'COMPATIBLE',
        decisions: [],
      }),
    ).toThrow('Publication was stopped to prevent Current firmware from becoming Unknown')
  })

  it('fails publication instead of silently losing an explicitly verified current-firmware link', () => {
    expect(() =>
      importerV2CurrentFirmwareReleaseId({
        releaseId: null,
        runningVersion: '15.2(7)E2',
        softwarePlatform: 'IOS',
        compatibilityStatus: 'UNKNOWN',
        decisions: [
          {
            action: 'VERIFY_OBSERVED_FIRMWARE',
            value: {
              runningVersion: '15.2(7)E2',
              softwarePlatform: 'IOS',
              originalCompatibilityStatus: 'UNKNOWN',
              verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
            },
          },
        ],
      }),
    ).toThrow('Publication was stopped to prevent Current firmware from becoming Unknown')
  })
})
