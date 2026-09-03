import { describe, expect, it } from 'vitest'
import { currentLinkedDependencyTarget, stagedReferenceDependsOn } from '@/lib/device-import-staging-dependencies'

function reference(kind: string, source: string, metadata: Record<string, unknown> = {}) {
  return { kind, normalizedSourceValue: source.toLowerCase(), metadata }
}

describe('currentLinkedDependencyTarget', () => {
  it('replaces stale child metadata with the currently linked Vendor target', () => {
    const references = [{
      kind: 'VENDOR',
      normalizedSourceValue: 'aerohive',
      status: 'LINKED',
      targetId: 'vendor-aerohive',
    }]

    expect(currentLinkedDependencyTarget('VENDOR', 'Aerohive', references, 'vendor-old')).toBe('vendor-aerohive')
  })

  it('does not retain a stale dependency target while its source reference is unresolved', () => {
    const references = [{
      kind: 'DEVICE_TYPE',
      normalizedSourceValue: 'access point',
      status: 'UNRESOLVED',
      targetId: null,
    }]

    expect(currentLinkedDependencyTarget('DEVICE_TYPE', 'Access Point', references, 'type-old')).toBeNull()
  })
})

describe('stagedReferenceDependsOn', () => {
  it('targets only Sites belonging to the resolved raw Customer', () => {
    const customer = reference('CUSTOMER', 'Unica Groep')
    expect(stagedReferenceDependsOn(customer, reference('SITE', 'Deventer', { customerSourceValue: 'Unica Groep' }))).toBe(true)
    expect(stagedReferenceDependsOn(customer, reference('SITE', 'Zwolle', { customerSourceValue: 'Other Customer' }))).toBe(false)
    expect(stagedReferenceDependsOn(customer, reference('DEVICE_MODEL', 'FortiGate-100F'))).toBe(false)
  })

  it('targets Models by their Vendor and Device Type dependencies', () => {
    const vendor = reference('VENDOR', 'Fortinet')
    const type = reference('DEVICE_TYPE', 'Firewall')
    const model = reference('DEVICE_MODEL', 'FortiGate-100F', {
      vendorSourceValue: 'Fortinet',
      deviceTypeSourceValue: 'Firewall',
    })

    expect(stagedReferenceDependsOn(vendor, model)).toBe(true)
    expect(stagedReferenceDependsOn(type, model)).toBe(true)
    expect(stagedReferenceDependsOn(reference('VENDOR', 'Cisco'), model)).toBe(false)
  })

  it('keeps Firmware dependencies scoped to the raw Model and Vendor', () => {
    const fortinetModel = reference('DEVICE_MODEL', '100F', { vendorSourceValue: 'Fortinet' })
    const ciscoModel = reference('DEVICE_MODEL', '100F', { vendorSourceValue: 'Cisco' })
    const fortinetFirmware = reference('FIRMWARE_RELEASE', '7.4.12', {
      modelSourceValue: '100F',
      vendorSourceValue: 'Fortinet',
    })

    expect(stagedReferenceDependsOn(fortinetModel, fortinetFirmware)).toBe(true)
    expect(stagedReferenceDependsOn(ciscoModel, fortinetFirmware)).toBe(false)
  })
})
