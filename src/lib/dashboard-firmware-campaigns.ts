import { createHash } from 'node:crypto'
import { compareFirmwareVersions } from '@/lib/firmware-versioning'
import type { WorkPackageFinding } from '@/lib/dashboard-work-packages'

export type CampaignSeverity = 'CRITICAL' | 'REQUIRED' | 'RECOMMENDED' | 'REVIEW'
export type CampaignRelease = {
  version: string
  deviceCount: number
  customerCount: number
  criticalCount: number
  requiredCount: number
  acceptedCount: number
  order: 'LESS' | 'EQUAL' | 'GREATER' | 'NOT_COMPARABLE'
}
export type FirmwareCampaign = {
  id: string
  vendor: WorkPackageFinding['vendor']
  platform: string
  sourceTrain: string
  targetVersion: string | null
  targetPlatform: string | null
  targetTrain: string | null
  severity: CampaignSeverity
  reason: string
  deviceCount: number
  customerCount: number
  criticalCount: number
  requiredCount: number
  recommendedCount: number
  reviewCount: number
  awaitingCustomerCount: number
  plannedCount: number
  deviceIds: string[]
  findings: WorkPackageFinding[]
  releases: CampaignRelease[]
}

function normalize(value: string | null | undefined): string | null {
  return value?.normalize('NFKC').trim() || null
}

/**
 * Treat historical Fortinet "FortiGate" software labels as FortiOS, but only
 * for Fortinet firmware campaigns. Other Fortinet families such as FortiSwitch,
 * FortiAP and FortiManager remain different firmware/platform domains.
 *
 * Keep this as a read-model normalization: never rewrite the source catalog
 * or treat coincidentally identical version numbers as proof of compatibility.
 */
export function normalizedCampaignPlatform(vendorName: string, rawPlatform: string | null | undefined): string {
  const value = normalize(rawPlatform)
  if (!value) return 'Onbekend platform'
  const folded = value.toLocaleLowerCase('en-US')
  if (vendorName.trim().toLocaleLowerCase('en-US') === 'fortinet' &&
      (folded === 'fortigate' || folded === 'fortios')) {
    return 'FortiOS'
  }
  return value
}

function derivedNumericTrain(version: string | null | undefined): string | null {
  const match = /^(\d+)\.(\d+)\./.exec(version ?? '')
  return match ? match[1] + '.' + match[2] : null
}

/** Same firmware migration target, platform and train, across all customers. */
function identity(finding: WorkPackageFinding) {
  const version = normalize(finding.currentFirmwareVersion)
  const sourceTrain = normalize(finding.currentTrain) ??
    derivedNumericTrain(version) ??
    'Onbekende train'
  const platform = normalizedCampaignPlatform(finding.vendor.name, finding.currentPlatform)
  const targetPlatform = normalize(finding.targetPlatform)
    ? normalizedCampaignPlatform(finding.vendor.name, finding.targetPlatform)
    : null
  return {
    key: JSON.stringify([
      finding.vendor.id,
      platform,
      sourceTrain,
      targetPlatform,
      normalize(finding.targetTrain),
      normalize(finding.targetVersion),
    ]),
    sourceTrain,
    platform,
    targetPlatform,
  }
}

function severityOf(finding: WorkPackageFinding): CampaignSeverity | null {
  if (finding.status === 'CRITICAL_ATTENTION') return 'CRITICAL'
  if (finding.status === 'UPDATE_REQUIRED') return 'REQUIRED'
  if (finding.status === 'UPDATE_RECOMMENDED') return 'RECOMMENDED'
  if (finding.status === 'REVIEW_REQUIRED' || finding.status === 'UNKNOWN') return 'REVIEW'
  // Current, exception accepted and already compliant findings are not an update campaign.
  return null
}

const priority: Record<CampaignSeverity, number> = {
  CRITICAL: 4,
  REQUIRED: 3,
  RECOMMENDED: 2,
  REVIEW: 1,
}

type Draft = FirmwareCampaign & {
  membership: Set<string>
  releaseMembership: Map<string, Set<string>>
  customerMembership: Set<string>
}

/**
 * Technical campaigns are cross-customer remediation cohorts.
 * The campaign is a read-only projection; actual maintenance plans remain
 * per-customer/site and require separate approval.
 *
 * IMPORTANT: catalog-blocked firmware is NOT proof of a specific CVE.
 */
export function buildFirmwareCampaigns(findings: readonly WorkPackageFinding[]): FirmwareCampaign[] {
  const groups = new Map<string, Draft>()

  for (const finding of findings) {
    const severity = severityOf(finding)
    if (!severity) continue

    const keyParts = identity(finding)
    let campaign = groups.get(keyParts.key)
    if (!campaign) {
      const id = createHash('sha256').update(keyParts.key).digest('hex').slice(0, 24)
      campaign = {
        id,
        vendor: finding.vendor,
        platform: keyParts.platform,
        sourceTrain: keyParts.sourceTrain,
        targetVersion: normalize(finding.targetVersion),
        targetPlatform: keyParts.targetPlatform,
        targetTrain: normalize(finding.targetTrain),
        severity,
        reason: severity === 'CRITICAL'
          ? 'Firmware requires attention under the catalog or compatibility policy.'
          : severity === 'REQUIRED'
            ? 'Firmware is below the accepted policy threshold.'
            : severity === 'RECOMMENDED'
              ? 'A preferred release is available under the configured policy.'
              : 'Current firmware or policy requires investigation.',
        deviceCount: 0,
        customerCount: 0,
        criticalCount: 0,
        requiredCount: 0,
        recommendedCount: 0,
        reviewCount: 0,
        awaitingCustomerCount: 0,
        plannedCount: 0,
        deviceIds: [],
        findings: [],
        releases: [],
        membership: new Set(),
        releaseMembership: new Map(),
        customerMembership: new Set(),
      }
      groups.set(keyParts.key, campaign)
    }

    if (campaign.membership.has(finding.deviceId)) continue
    campaign.membership.add(finding.deviceId)
    campaign.deviceIds.push(finding.deviceId)
    campaign.findings.push(finding)
    campaign.customerMembership.add(finding.customer.id)
    campaign.deviceCount++
    if (priority[severity] > priority[campaign.severity]) {
      campaign.severity = severity
      campaign.reason = severity === 'CRITICAL'
        ? 'Firmware requires attention under the catalog or compatibility policy.'
        : 'Some devices require an update under the configured policy.'
    }
    if (severity === 'CRITICAL') campaign.criticalCount++
    else if (severity === 'REQUIRED') campaign.requiredCount++
    else if (severity === 'RECOMMENDED') campaign.recommendedCount++
    else campaign.reviewCount++
    if (finding.plan?.state === 'AWAITING_CUSTOMER') campaign.awaitingCustomerCount++
    else if (finding.plan) campaign.plannedCount++

    const version = normalize(finding.currentFirmwareVersion) ?? 'Onbekend'
    let cohort = campaign.releases.find((item) => item.version === version)
    if (!cohort) {
      cohort = {
        version,
        deviceCount: 0,
        customerCount: 0,
        criticalCount: 0,
        requiredCount: 0,
        acceptedCount: 0,
        order: 'NOT_COMPARABLE',
      }
      campaign.releases.push(cohort)
    }
    cohort.deviceCount++
    if (severity === 'CRITICAL') cohort.criticalCount++
    if (severity === 'REQUIRED') cohort.requiredCount++
    if (finding.compliance === 'ACCEPTED') cohort.acceptedCount++
    const customers = campaign.releaseMembership.get(version) ?? new Set<string>()
    customers.add(finding.customer.id)
    campaign.releaseMembership.set(version, customers)
  }

  return [...groups.values()].map((group) => {
    const target = group.targetVersion
    for (const release of group.releases) {
      release.customerCount = group.releaseMembership.get(release.version)?.size ?? 0
      if (target && release.version !== 'Onbekend') {
        release.order = compareFirmwareVersions({
          vendorKey: group.vendor.name,
          platform: group.platform,
          leftVersion: release.version,
          rightVersion: target,
        }).result
      }
    }
    // Blocked and required first; for comparable versions, older first.
    group.releases.sort((a, b) =>
      b.criticalCount - a.criticalCount ||
      b.requiredCount - a.requiredCount ||
      (a.order === 'LESS' && b.order !== 'LESS' ? -1 :
        b.order === 'LESS' && a.order !== 'LESS' ? 1 : 0) ||
      compareReleaseWithinTrain(group, a.version, b.version) ||
      a.version.localeCompare(b.version),
    )
    return {
      id: group.id,
      vendor: group.vendor,
      platform: group.platform,
      sourceTrain: group.sourceTrain,
      targetVersion: group.targetVersion,
      targetPlatform: group.targetPlatform,
      targetTrain: group.targetTrain,
      severity: group.severity,
      reason: group.reason,
      deviceCount: group.deviceCount,
      customerCount: group.customerMembership.size,
      criticalCount: group.criticalCount,
      requiredCount: group.requiredCount,
      recommendedCount: group.recommendedCount,
      reviewCount: group.reviewCount,
      awaitingCustomerCount: group.awaitingCustomerCount,
      plannedCount: group.plannedCount,
      deviceIds: group.deviceIds.sort(),
      findings: group.findings.sort((a, b) =>
        a.customer.name.localeCompare(b.customer.name) ||
        (a.site?.name ?? '').localeCompare(b.site?.name ?? '') ||
        (a.deviceName ?? a.deviceId).localeCompare(b.deviceName ?? b.deviceId),
      ),
      releases: group.releases,
    }
  }).sort((a, b) =>
    priority[b.severity] - priority[a.severity] ||
    b.criticalCount - a.criticalCount ||
    b.requiredCount - a.requiredCount ||
    b.deviceCount - a.deviceCount ||
    a.vendor.name.localeCompare(b.vendor.name) ||
    a.sourceTrain.localeCompare(b.sourceTrain) ||
    a.id.localeCompare(b.id),
  )
}

function compareReleaseWithinTrain(group: FirmwareCampaign, left: string, right: string): number {
  if (left === 'Onbekend') return 1
  if (right === 'Onbekend') return -1
  const result = compareFirmwareVersions({
    vendorKey: group.vendor.name,
    platform: group.platform,
    leftVersion: left,
    rightVersion: right,
  }).result
  if (result === 'LESS') return -1
  if (result === 'GREATER') return 1
  return 0
}

/** Consistent aggregate counts: one device may be in only one campaign. */
export function countFirmwareCampaigns(campaigns: readonly FirmwareCampaign[]) {
  return {
    campaigns: campaigns.length,
    devices: campaigns.reduce((sum, item) => sum + item.deviceCount, 0),
    criticalDevices: campaigns.reduce((sum, item) => sum + item.criticalCount, 0),
    updateRequiredDevices: campaigns.reduce((sum, item) => sum + item.requiredCount, 0),
    recommendedDevices: campaigns.reduce((sum, item) => sum + item.recommendedCount, 0),
    reviewDevices: campaigns.reduce((sum, item) => sum + item.reviewCount, 0),
    awaitingCustomerDevices: campaigns.reduce((sum, item) => sum + item.awaitingCustomerCount, 0),
  }
}
