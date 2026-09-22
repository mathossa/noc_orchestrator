import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DesiredFirmwareEditor } from './desired-firmware-editor'
import { release as catalogRelease } from '@/lib/test-fixtures/firmware-compliance'
import type { FirmwarePolicyMode } from '@/lib/firmware-policies'

function model(
  mode: FirmwarePolicyMode,
): ComponentProps<typeof DesiredFirmwareEditor>['model'] {
  const release = {
    ...catalogRelease(),
    releasedAt: null,
    id: 'preferred',
    version: '17.15.5',
    platform: 'IOS XE',
    selectable: true,
  }
  return {
    id: 'synthetic-model',
    vendorId: 'synthetic-vendor',
    desiredFirmware: {
      available: true,
      trackKey: 'default',
      policyId: 'policy',
      policyMode: mode,
      desiredPlatform: 'IOS XE',
      release,
      minimumRelease: { ...release, id: 'minimum', version: '17.12.5' },
      maximumRelease: { ...release, id: 'maximum', version: '17.15.6' },
      minimumInclusive: false,
      maximumInclusive: true,
      firmwareTrain: {
        id: 'train',
        name: 'Synthetic approved train',
        platform: 'IOS XE',
      },
    },
    availableFirmware: { available: true, releases: [release] },
    effectiveCatalogDefaults: [],
  }
}
describe('replacement Desired firmware editor', () => {
  it.each(['EXACT', 'MINIMUM', 'RANGE', 'LATEST_APPROVED_IN_TRAIN'] as const)(
    'reopens saved %s with relevant controls at the existing anchor',
    (mode) => {
      const markup = renderToStaticMarkup(
        createElement(DesiredFirmwareEditor, {
          model: model(mode),
          compatibility: new Map(),
          onSaved: () => {},
        }),
      )
      expect(markup.match(/id="desired-firmware-policy"/g)).toHaveLength(1)
      expect(markup).toContain(`value="${mode}" selected=""`)
      expect(markup.includes('id="policy-minimumFirmwareReleaseId"')).toBe(
        mode === 'MINIMUM' || mode === 'RANGE',
      )
      expect(markup.includes('id="policy-maximumFirmwareReleaseId"')).toBe(
        mode === 'RANGE',
      )
      expect(markup.includes('id="policy-train"')).toBe(
        mode === 'LATEST_APPROVED_IN_TRAIN',
      )
      expect(markup.includes('id="policy-targetFirmwareReleaseId"')).toBe(
        mode !== 'LATEST_APPROVED_IN_TRAIN',
      )
      expect(markup).toContain('Save model override')
      expect(markup).toContain('Remove model override')
      if (mode === 'LATEST_APPROVED_IN_TRAIN')
        expect(markup).toContain('Synthetic approved train')
    },
  )

  it('presents catalog inheritance before offering an optional model override', () => {
    const base = model('EXACT')
    const inherited = {
      ...base,
      desiredFirmware: {
        ...base.desiredFirmware,
        policyId: null,
        policyMode: null,
        desiredPlatform: null,
        release: null,
        minimumRelease: null,
        maximumRelease: null,
        firmwareTrain: null,
        trackKey: null,
      },
      effectiveCatalogDefaults: [
        {
          releaseId: 'preferred',
          version: '17.15.5',
          platform: 'IOS XE',
          trainName: '17.15',
          deviceCount: 3,
        },
      ],
    }
    const markup = renderToStaticMarkup(
      createElement(DesiredFirmwareEditor, {
        model: inherited,
        compatibility: new Map(),
        onSaved: () => {},
      }),
    )

    expect(markup).toContain('Firmware Catalog drives compliance automatically')
    expect(markup).toContain('17.15.5')
    expect(markup).toContain('3 devices')
    expect(markup).toContain('Configure model override')
    expect(markup).not.toContain('id="policy-targetFirmwareReleaseId"')
  })

})
