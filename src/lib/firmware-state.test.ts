import { describe, expect, it } from 'vitest'
import { resolveTechnicalFirmwareState } from '@/lib/firmware-state'

describe('technical firmware state resolution', () => {
  it('returns NO_POLICY before considering current firmware', () => {
    expect(resolveTechnicalFirmwareState({ currentFirmwareReleaseId: null, desiredFirmwareReleaseId: null })).toBe('NO_POLICY')
    expect(resolveTechnicalFirmwareState({ currentFirmwareReleaseId: 'release-1', desiredFirmwareReleaseId: null })).toBe('NO_POLICY')
  })

  it('returns UNKNOWN when desired exists but current firmware is missing', () => {
    expect(resolveTechnicalFirmwareState({ currentFirmwareReleaseId: null, desiredFirmwareReleaseId: 'desired-1' })).toBe('UNKNOWN')
  })

  it('returns CURRENT only when the exact recorded release equals the desired release', () => {
    expect(resolveTechnicalFirmwareState({ currentFirmwareReleaseId: 'release-1', desiredFirmwareReleaseId: 'release-1' })).toBe('CURRENT')
  })

  it('returns ACTION_REQUIRED for any different exact release without ordering version strings', () => {
    expect(resolveTechnicalFirmwareState({ currentFirmwareReleaseId: 'opaque-current', desiredFirmwareReleaseId: 'opaque-desired' })).toBe('ACTION_REQUIRED')
  })
})
