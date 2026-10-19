import { describe, expect, it } from 'vitest'
import { resolveCanonicalFortiosRepair, type CanonicalRepairRelease } from '@/lib/firmware-canonical-repair'

const old: CanonicalRepairRelease = {
  id: 'old', vendorId: 'fortinet', platform: 'FortiGate', version: '7.4.11',
  logicalVersion: '7.4.11', variant: null, imageCode: null, isActive: true,
  firmwareTrain: null,
}
const target: CanonicalRepairRelease = {
  ...old, id: 'new', platform: 'FortiOS',
  firmwareTrain: { id: 'train74', name: '7.4', platform: 'FortiOS', isActive: true },
}
const model = { vendorId: 'fortinet', platform: 'FortiOS', preferredPlatform: 'FortiOS' }
const match = (candidates: CanonicalRepairRelease[], source = old) =>
  resolveCanonicalFortiosRepair({ source, candidates, model, vendorIsFortinet: true })

describe('#152 current inventory canonical FortiOS relink', () => {
  it('relinks only the unique exact matching release', () => {
    expect(match([target])).toEqual({ status: 'MATCHED', targetId: 'new', candidateIds: ['new'] })
  })
  it('does not change 7.4.11 to 7.4.12 or a different logical version', () => {
    expect(match([{ ...target, version: '7.4.12' }]).status).toBe('MISSING_TARGET')
    expect(match([{ ...target, logicalVersion: '7.4' }]).status).toBe('MISSING_TARGET')
  })
  it('does not merge firmware variants or images', () => {
    expect(match([{ ...target, variant: 'special' }]).status).toBe('MISSING_TARGET')
    expect(match([{ ...target, imageCode: 'alt-image' }]).status).toBe('MISSING_TARGET')
  })
  it('refuses two competing canonical matches', () => {
    expect(match([target, { ...target, id: 'another' }]).status).toBe('AMBIGUOUS')
  })
  it('does not convert other vendors, product families or unsupported models', () => {
    expect(match([{ ...target, vendorId: 'other' }]).status).toBe('MISSING_TARGET')
    expect(match([target], { ...old, platform: 'FortiSwitch' }).status).toBe('NOT_APPLICABLE')
    expect(resolveCanonicalFortiosRepair({
      source: old, model: { ...model, platform: 'FortiSwitch' },
      candidates: [target], vendorIsFortinet: true,
    }).status).toBe('UNSUPPORTED_MODEL')
  })
  it('preserves correct links and refuses inactive target trains', () => {
    expect(match([target], target).status).toBe('ALREADY_CORRECT')
    expect(match([{ ...target, firmwareTrain: { ...target.firmwareTrain!, isActive: false } }]).status).toBe('MISSING_TARGET')
  })
  it('checks the train if both sources have one', () => {
    expect(match([target], { ...old, firmwareTrain: { id: 'legacy', name: '7.6', platform: 'FortiGate', isActive: true } }).status)
      .toBe('MISSING_TARGET')
  })
})
