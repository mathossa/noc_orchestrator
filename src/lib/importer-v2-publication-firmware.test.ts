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

  it.each(['COMPATIBLE', 'UNKNOWN', 'INCOMPATIBLE'])(
    'links an exact canonical observed release independently of %s compatibility',
    (compatibilityStatus) => {
      expect(
        importerV2CurrentFirmwareReleaseId({
          releaseId: 'release-mr-32-2-4',
          runningVersion: 'MR 32.2.4',
          softwarePlatform: 'Meraki MR',
          compatibilityStatus,
          decisions: [],
        }),
      ).toBe('release-mr-32-2-4')
    },
  )

  it('keeps a concrete observation publishable when no canonical release identity can be resolved', () => {
    expect(
      importerV2CurrentFirmwareReleaseId({
        releaseId: null,
        runningVersion: 'MR 32.2.4',
        softwarePlatform: 'Meraki MR',
        compatibilityStatus: 'UNKNOWN',
        decisions: [],
      }),
    ).toBeNull()
  })
})
