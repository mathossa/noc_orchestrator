import { describe, expect, it } from 'vitest'
import { resolveInventoryFirmwareLink, manualInventoryFirmwareTargets, type FirmwareLinkRelease } from '@/lib/inventory-firmware-repair'

const linked: FirmwareLinkRelease = {
  id: 'old', vendorId: 'vendor-1', platform: 'Device hardware family', version: '7.4.11',
  logicalVersion: '7.4.11', variant: null, imageCode: null, isActive: true, firmwareTrain: null,
}
const canonical: FirmwareLinkRelease = {
  ...linked, id: 'approved', platform: 'Software OS',
  firmwareTrain: { id: 'train74', name: '7.4', platform: 'Software OS', isActive: true },
}
const model = {
  vendorId: 'vendor-1', platform: 'Software OS', preferredPlatform: 'Software OS',
}
const check = (releases: FirmwareLinkRelease[], current: FirmwareLinkRelease | null = linked, observedVersion: string | null = '7.4.11') =>
  resolveInventoryFirmwareLink({ model, current, observedVersion, releases })

describe('#152 vendor-neutral recorded inventory firmware linking', () => {
  it('resolves an exact compatible target, regardless of vendor/product labels', () => {
    expect(check([canonical])).toEqual({
      status: 'MATCHED', targetId: 'approved', candidateIds: ['approved'],
    })
    const ciscoModel = { vendorId: 'cisco', platform: 'IOS', preferredPlatform: 'IOS' }
    const cisco = { ...canonical, vendorId: 'cisco', platform: 'IOS', firmwareTrain: null }
    expect(resolveInventoryFirmwareLink({
      model: ciscoModel,
      current: { ...linked, vendorId: 'cisco', platform: 'Catalyst' },
      observedVersion: '7.4.11',
      releases: [cisco],
    }).status).toBe('MATCHED')
  })
  it('does not invent a source observation when only a linked release exists', () => {
    expect(check([canonical], linked, null).status).toBe('NO_OBSERVATION')
  })
  it('can link a previously unmatched device with genuine version evidence', () => {
    expect(check([canonical], null).targetId).toBe('approved')
  })
  it('provides optional manual targets for a properly observed current device', () => {
    expect(manualInventoryFirmwareTargets({
      model, current: linked, observedVersion: '7.4.11',
      releases: [canonical],
    }).map((release) => release.id)).toEqual(['approved'])
  })
  it('does not fabricate manual choices for a different observed version, image or vendor', () => {
    const run = (releases: FirmwareLinkRelease[], observedVersion = '7.4.11') =>
      manualInventoryFirmwareTargets({ model, current: linked, observedVersion, releases })
    expect(run([{ ...canonical, version: '7.4.12' }])).toEqual([])
    expect(run([{ ...canonical, imageCode: 'different' }])).toEqual([])
    expect(run([{ ...canonical, vendorId: 'different' }])).toEqual([])
    expect(run([canonical], '7.4.12')).toEqual([])
  })
  it('keeps a canonical link already supported by the model', () => {
    expect(check([canonical], canonical).status).toBe('CORRECT')
  })
  it('blocks stale links that conflict with the reported running version', () => {
    expect(check([{ ...canonical, version: '7.4.12' }], linked, '7.4.12').status)
      .toBe('EVIDENCE_CONFLICT')
  })
  it('never maps to a different version or a different vendor', () => {
    expect(check([{ ...canonical, version: '7.4.12' }]).status).toBe('MISSING_TARGET')
    expect(check([{ ...canonical, vendorId: 'other-vendor' }]).status).toBe('MISSING_TARGET')
  })
  it('rejects unsupported model platforms and unsupported firmware families', () => {
    expect(resolveInventoryFirmwareLink({
      model: { ...model, platform: 'Different OS' },
      current: linked, observedVersion: '7.4.11', releases: [canonical],
    }).status).toBe('MISSING_TARGET')
    expect(resolveInventoryFirmwareLink({
      model: { ...model, platform: null },
      current: linked, observedVersion: '7.4.11', releases: [canonical],
    }).status).toBe('UNSUPPORTED_MODEL')
  })
  it('does not merge release artifacts with differing variants or images', () => {
    expect(check([{ ...canonical, variant: 'special' }]).status).toBe('MISSING_TARGET')
    expect(check([{ ...canonical, imageCode: 'alternate' }]).status).toBe('MISSING_TARGET')
  })
  it('stops when several compatible canonical IDs exist', () => {
    expect(check([canonical, { ...canonical, id: 'another' }]).status).toBe('AMBIGUOUS')
  })
  it('does not link to inactive releases or inactive trains', () => {
    expect(check([{ ...canonical, isActive: false }]).status).toBe('MISSING_TARGET')
    expect(check([{ ...canonical, firmwareTrain: { ...canonical.firmwareTrain!, isActive: false } }]).status)
      .toBe('MISSING_TARGET')
  })
  it('requires the train name to match when both sides declare an identity', () => {
    expect(check([canonical], { ...linked,
      firmwareTrain: { id: 'old-train', name: '7.6', platform: 'Device hardware family', isActive: true },
    }).status).toBe('MISSING_TARGET')
  })
})
