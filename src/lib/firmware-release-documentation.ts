/**
 * Issue #103: Links describe where evidence can be found; they do not claim a
 * particular firmware is supported, secure, or upgradeable.
 *
 * Keep vendor URL templates conservative. A predictable vendor URL is NOT
 * considered verified until a human/source adapter has checked it.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export const firmwareDocumentTypes = [
  'RELEASE_NOTES',
  'UPGRADE_GUIDE',
  'DOWNLOAD_PAGE',
  'KNOWN_ISSUES',
  'COMPATIBILITY',
  'SECURITY',
  'INTERNAL_RUNBOOK',
  'OTHER',
] as const

export type FirmwareDocumentType = (typeof firmwareDocumentTypes)[number]
export type FirmwareDocumentMatch = 'EXACT_VERSION' | 'PLATFORM_INDEX'
export type FirmwareDocumentOrigin = 'MANUAL' | 'LEGACY' | 'AUTO_SUGGESTED'

export type FirmwareDocumentLink = {
  id: string
  type: FirmwareDocumentType
  title: string
  url: string
  source: string
  notes: string | null
  origin: FirmwareDocumentOrigin
  match: FirmwareDocumentMatch
  verifiedAt: string | null
}

export type FirmwareDocumentRelease = {
  vendor: { code: string; name: string }
  platform: string
  version: string
  releaseNotesUrl?: string | null
}

function link(type: FirmwareDocumentType, title: string, url: string, source: string, match: FirmwareDocumentMatch): FirmwareDocumentLink {
  return {
    id: `suggested:${url}`,
    type,
    title,
    url,
    source,
    origin: 'AUTO_SUGGESTED',
    match,
    notes: null,
    verifiedAt: null,
  }
}

/**
 * Public, manufacturer-owned entry points only. Never synthesize model- or
 * build-specific deep links from guessed slugs.
 */
export function suggestFirmwareDocuments(release: FirmwareDocumentRelease): FirmwareDocumentLink[] {
  const vendor = `${release.vendor.code} ${release.vendor.name}`.toLowerCase()
  const platform = release.platform.toLowerCase().replace(/[\s_]+/g, '-')
  const normalizedVersion = release.version.trim()
  const exactVersion = /^v?(\d+\.\d+\.\d+)(?:$|[,\s(-])/i.exec(normalizedVersion)?.[1]

  if (/fortinet/.test(vendor)) {
    if (!exactVersion) return []
    if (/fortios|fortigate/.test(platform)) {
      return [link('RELEASE_NOTES', `FortiOS ${exactVersion} release notes`,
        `https://docs.fortinet.com/document/fortigate/${exactVersion}/fortios-release-notes`, 'Fortinet', 'EXACT_VERSION')]
    }
    if (/fortiswitch/.test(platform)) {
      return [link('RELEASE_NOTES', `FortiSwitchOS ${exactVersion} release notes`,
        `https://docs.fortinet.com/document/fortiswitch/${exactVersion}/fortiswitchos-release-notes`, 'Fortinet', 'EXACT_VERSION')]
    }
    return []
  }

  if (/\b(aruba|hpe|hewlett.packard)\b/.test(vendor)) {
    if (/aos-cx|arubaos-cx/.test(platform)) {
      return [link('RELEASE_NOTES', 'AOS-CX consolidated release notes (select switch series)',
        'https://arubanetworking.hpe.com/techdocs/AOS-CX/Consolidated_RNs/Portal_Home/Content/cx-home.htm', 'HPE Aruba Networking', 'PLATFORM_INDEX')]
    }
    if (/aos-?10|arubaos-?10/.test(platform)) {
      return [link('RELEASE_NOTES', 'AOS-10 consolidated release notes',
        'https://arubanetworking.hpe.com/techdocs/AOS_10.x_RN_WebHelp/Content/Home.htm', 'HPE Aruba Networking', 'PLATFORM_INDEX')]
    }
    if (/aos-?8|arubaos-?8|instant-os-?8/.test(platform)) {
      return [link('RELEASE_NOTES', 'AOS-8 release notes',
        'https://arubanetworking.hpe.com/techdocs/ArubaDocPortal/content/new-portal/aos8.html', 'HPE Aruba Networking', 'PLATFORM_INDEX')]
    }
    if (/instant-?on/.test(platform)) {
      return [link('RELEASE_NOTES', 'HPE Networking Instant On release notes',
        'https://instant-on.hpe.com/techdocs/en/content/whats_new/release-notes.htm', 'HPE Networking', 'PLATFORM_INDEX')]
    }
    return []
  }

  if (/meraki/.test(vendor)) {
    return [link('RELEASE_NOTES', 'Meraki firmware changelog (select firmware version in Dashboard)',
      'https://documentation.meraki.com/Platform_Management/Product_Information/Compatibility_and_Firmware',
      'Cisco Meraki', 'PLATFORM_INDEX')]
  }

  if (/cisco/.test(vendor)) {
    return [link('OTHER', 'Cisco product documentation and release notes (select model and train)',
      'https://www.cisco.com/c/en/us/support/index.html', 'Cisco', 'PLATFORM_INDEX')]
  }

  // Unsupported vendors are not silently assigned a guessed link. Typed
  // manual references work for any vendor; add a verified adapter later.
  return []
}

export function isSafeFirmwareDocumentUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      Boolean(parsed.hostname) && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

/** Prefer stored/verified references over generated suggestions for the same URL. */
export function mergeFirmwareDocumentLinks(
  stored: FirmwareDocumentLink[],
  suggested: FirmwareDocumentLink[],
): FirmwareDocumentLink[] {
  const urls = new Set(stored.map((item) => item.url.replace(/\/$/, '').toLowerCase()))
  return [...stored, ...suggested.filter((item) => !urls.has(item.url.replace(/\/$/, '').toLowerCase()))]
}
