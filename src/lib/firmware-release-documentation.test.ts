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
})
