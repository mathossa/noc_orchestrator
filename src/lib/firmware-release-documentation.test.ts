import { describe, expect, it } from 'vitest'
import {
  isSafeFirmwareDocumentUrl,
  mergeFirmwareDocumentLinks,
  suggestFirmwareDocuments,
} from './firmware-release-documentation'

describe('firmware documentation discovery', () => {
  it('derives a FortiOS document from the exact running or preferred version, never another version', () => {
    const refs = suggestFirmwareDocuments({
      vendor: { code: 'FORTINET', name: 'Fortinet' },
      platform: 'FortiOS',
      version: 'v7.6.4,build3596',
    })
    expect(refs).toMatchObject([{
      match: 'EXACT_VERSION',
      origin: 'AUTO_SUGGESTED',
      verifiedAt: null,
      url: 'https://docs.fortinet.com/document/fortigate/7.6.4/fortios-release-notes',
    }])
  })

  it('derives FortiSwitchOS separately and refuses unknown Fortinet families', () => {
    const vendor = { code: 'FTNT', name: 'Fortinet' }
    expect(suggestFirmwareDocuments({ vendor, platform: 'FortiSwitchOS', version: '7.4.6' })[0].url)
      .toBe('https://docs.fortinet.com/document/fortiswitch/7.4.6/fortiswitchos-release-notes')
    expect(suggestFirmwareDocuments({ vendor, platform: 'FortiAP', version: '7.4.6' })).toEqual([])
  })

  it('never misrepresents an Aruba model-dependent portal as exact release documentation', () => {
    const docs = suggestFirmwareDocuments({
      vendor: { code: 'ARUBA', name: 'HPE Aruba Networking' },
      platform: 'AOS-CX',
      version: '10.15.1060',
    })
    expect(docs[0].match).toBe('PLATFORM_INDEX')
    expect(docs[0].url).toContain('Consolidated_RNs')
  })

  it('uses a release portal for Meraki rather than inventing per-firmware URLs', () => {
    const docs = suggestFirmwareDocuments({
      vendor: { code: 'MERAKI', name: 'Cisco Meraki' },
      platform: 'MR',
      version: '32.2.4',
    })
    expect(docs[0].match).toBe('PLATFORM_INDEX')
  })

  it('falls back to the official Junos release index for service-build and unknown formats', () => {
    const result = suggestFirmwareDocuments({
      vendor: { code: 'JUNIPER', name: 'Juniper Networks' },
      platform: 'Junos', version: '24.2R2-S1',
    })
    expect(result[0].match).toBe('PLATFORM_INDEX')
  })

  it('does not manufacture links for unknown suppliers or versions', () => {
    expect(suggestFirmwareDocuments({
      vendor: { code: 'OTHER', name: 'Other Vendor' },
      platform: 'OS', version: '1.0',
    })).toEqual([])
    expect(suggestFirmwareDocuments({
      vendor: { code: 'FORTINET', name: 'Fortinet' },
      platform: 'FortiOS', version: 'unknown',
    })).toEqual([])
  })

  it('validates protocols and credentials to prevent unsafe links', () => {
    expect(isSafeFirmwareDocumentUrl('https://docs.fortinet.com/example')).toBe(true)
    expect(isSafeFirmwareDocumentUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeFirmwareDocumentUrl('https://user:password@example.org')).toBe(false)
  })

  it('does not duplicate legacy/manual references when auto suggestions match', () => {
    const refs = suggestFirmwareDocuments({
      vendor: { code: 'FORTINET', name: 'Fortinet' },
      platform: 'FortiOS', version: '7.6.4',
    })
    expect(mergeFirmwareDocumentLinks([{ ...refs[0], id: 'manual', origin: 'MANUAL' }], refs))
      .toHaveLength(1)
  })
  it('keeps one link when a legacy field duplicates a curated URL', () => {
    const suggested = suggestFirmwareDocuments({
      vendor: { code: 'FORTINET', name: 'Fortinet' },
      platform: 'FortiOS', version: '7.6.4',
    })[0]
    const url = suggested.url
    const curated = { ...suggested, id: 'maintained', origin: 'MANUAL' as const }
    const legacy = { ...suggested, id: 'legacy', origin: 'LEGACY' as const, url: url + '/' }
    const merged = mergeFirmwareDocumentLinks([curated, legacy], [suggested])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('maintained')
  })

  it('routes IOS XE 17 to the Cisco version family, not a guessed switch model', () => {
    const result = suggestFirmwareDocuments({
      vendor: { code: 'CISCO', name: 'Cisco Systems' },
      platform: 'IOS-XE', version: '17.15.5',
    })
    expect(result[0].match).toBe('PLATFORM_INDEX')
    expect(result[0].url).toContain('/ios-xe-17/products-release-notes-list.html')
  })

  it('supports other known vendors only with platform-level documentation', () => {
    const juniper = suggestFirmwareDocuments({
      vendor: { code: 'JUNIPER', name: 'Juniper Networks' },
      platform: 'Junos', version: '23.4R2',
    })
    const mikrotik = suggestFirmwareDocuments({
      vendor: { code: 'MKT', name: 'MikroTik' },
      platform: 'RouterOS', version: '7.23',
    })
    expect(juniper[0].match).toBe('EXACT_VERSION')
    expect(juniper[0].url).toBe('https://www.juniper.net/documentation/us/en/software/junos/release-notes/23.4/junos-release-notes-23.4r2/index.html')
    expect(mikrotik[0].match).toBe('PLATFORM_INDEX')
  })

})
