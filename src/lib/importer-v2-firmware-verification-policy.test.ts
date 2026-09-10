import { describe, expect, it } from 'vitest'
import {
  importerV2ObservedFirmwareVerificationDecision,
  importerV2ObservedFirmwareWasVerified,
} from '@/lib/importer-v2-firmware-verification-policy'

describe('Importer v2 observed firmware verification policy', () => {
  it('allows explicit verification when version and platform are known but compatibility is unknown', () => {
    expect(
      importerV2ObservedFirmwareVerificationDecision({
        proposedCanonicalValues: {
          currentFirmware: { id: null, label: '15.2(7)E2' },
          softwarePlatform: { id: null, label: 'IOS' },
        },
        firmware: {
          compatibility: { status: 'UNKNOWN' },
          warnings: [],
        },
      }),
    ).toEqual({
      status: 'VERIFY',
      value: {
        runningVersion: '15.2(7)E2',
        softwarePlatform: 'IOS',
        originalCompatibilityStatus: 'UNKNOWN',
        verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
      },
    })
  })

  it('does not require a redundant verification decision for already compatible evidence', () => {
    expect(
      importerV2ObservedFirmwareVerificationDecision({
        firmware: {
          runningVersion: '32.2.4',
          proposedSoftwarePlatform: 'Meraki MR',
          compatibility: { status: 'COMPATIBLE' },
          warnings: [],
        },
      }),
    ).toEqual({
      status: 'ALREADY_TRUSTED',
      runningVersion: '32.2.4',
      softwarePlatform: 'Meraki MR',
    })
  })

  it('keeps incompatible or conflicting evidence out of bulk verification', () => {
    expect(
      importerV2ObservedFirmwareVerificationDecision({
        firmware: {
          runningVersion: '17.12.5',
          proposedSoftwarePlatform: 'IOS-XE',
          compatibility: { status: 'INCOMPATIBLE' },
          warnings: [],
        },
      }).status,
    ).toBe('MANUAL_REVIEW')

    expect(
      importerV2ObservedFirmwareVerificationDecision({
        firmware: {
          runningVersion: '15.2(7)E2',
          proposedSoftwarePlatform: 'IOS',
          compatibility: { status: 'UNKNOWN' },
          warnings: [
            {
              code: 'FIRMWARE_EVIDENCE_CONFLICT',
              message: 'Firmware and software values disagree.',
            },
          ],
        },
      }),
    ).toMatchObject({ status: 'MANUAL_REVIEW' })
  })

  it('requires a platform before an observed release can be verified canonically', () => {
    expect(
      importerV2ObservedFirmwareVerificationDecision({
        firmware: {
          runningVersion: '1.2.3',
          compatibility: { status: 'NOT_APPLICABLE' },
          warnings: [],
        },
      }),
    ).toMatchObject({
      status: 'MANUAL_REVIEW',
      reason: expect.stringContaining('no software platform'),
    })
  })

  it('recognizes only the explicit observed-current-firmware verification decision', () => {
    expect(
      importerV2ObservedFirmwareWasVerified([
        {
          action: 'VERIFY_OBSERVED_FIRMWARE',
          value: {
            runningVersion: '15.2(7)E2',
            softwarePlatform: 'IOS',
            originalCompatibilityStatus: 'UNKNOWN',
            verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
          },
        },
      ]),
    ).toBe(true)
    expect(
      importerV2ObservedFirmwareWasVerified([
        { action: 'SET_FIELD', value: { label: '15.2(7)E2' } },
      ]),
    ).toBe(false)
  })
})
