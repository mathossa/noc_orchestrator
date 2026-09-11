import { describe, expect, it } from 'vitest'
import { resolveFirmwareCompliance } from './firmware-compliance'
import { input, policy, release } from './test-fixtures/firmware-compliance'

describe('firmware compliance logical version ordering', () => {
  it.each([
    ['MR', 'MR'],
    [null, null],
  ])(
    'orders Meraki display releases by logical version regardless of image code (%s/%s)',
    (currentImageCode, preferredImageCode) => {
      const current = release('MR 32.2.4', {
        vendorId: 'cisco',
        platform: 'Meraki MR',
        logicalVersion: '32.2.4',
        imageCode: currentImageCode,
      })
      const preferred = release('MR 32.2.5', {
        vendorId: 'cisco',
        platform: 'Meraki MR',
        logicalVersion: '32.2.5',
        imageCode: preferredImageCode,
      })
      const value = input('', {
        currentFirmware: current,
        preferredTarget: preferred,
        resolvedTarget: preferred,
        minimum: null,
      })
      value.effectivePolicy.policy = policy({
        policyMode: 'EXACT',
        targetFirmwareReleaseId: preferred.id,
        minimumFirmwareReleaseId: null,
        desiredPlatform: 'Meraki MR',
      })

      expect(resolveFirmwareCompliance(value)).toMatchObject({
        compliance: 'OUTSIDE_RANGE',
        relationToPreferred: 'BELOW_PREFERRED',
        recommendation: 'UPDATE_REQUIRED',
      })
    },
  )
})
