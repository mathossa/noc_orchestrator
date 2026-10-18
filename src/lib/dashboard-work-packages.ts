import type { InventoryPrimaryStatusCode } from '@/lib/inventory-status'

export type WorkPackageKind = 'URGENT' | 'TO_PLAN' | 'BLOCKED' | 'CHECK'
export type WorkPackageFinding = {
  deviceId: string
  customer: { id: string; name: string }
  site: { id: string; name: string } | null
  deviceTypeId: string
  vendor: { id: string; name: string }
  model: { id: string; name: string }
  firmwareKey: string | null
  status: InventoryPrimaryStatusCode
  reason: string
  managementContractId: string | null
  /** This is the authoritative persisted plan state, never inferred from firmware compliance. */
  plan: { id: string; state: 'PROPOSED' | 'AWAITING_CUSTOMER' | 'APPROVED' | 'SCHEDULED' | 'IN_PROGRESS' } | null
}

export type ActionWorkPackage = {
  id: string
  kind: WorkPackageKind
  findingKey: string
  title: string
  reason: string
  customer: WorkPackageFinding['customer']
  site: WorkPackageFinding['site']
  vendor: WorkPackageFinding['vendor']
  model: WorkPackageFinding['model']
  managementContractId: string | null
  deviceIds: string[]
  deviceCount: number
  href: string
  /** Unavailable until an authoritative assignment/task/plan deadline exists. */
  dueAt: string | null
  assigneeId: string | null
}

const rank: Record<WorkPackageKind, number> = {
  URGENT: 4,
  TO_PLAN: 3,
  BLOCKED: 2,
  CHECK: 1,
}

function rowLink(finding: WorkPackageFinding, status?: InventoryPrimaryStatusCode) {
  const siteId = finding.site?.id ?? 'unassigned'
  const base = '/devices/customers/' + encodeURIComponent(finding.customer.id) +
    '/sites/' + encodeURIComponent(siteId) + '/types/' + encodeURIComponent(finding.deviceTypeId)
  const params = new URLSearchParams({ model: finding.model.id })
  if (status) params.set('status', status)
  return base + '?' + params.toString()
}

type Candidate = { kind: WorkPackageKind; label: string; findingKey: string; reason: string; href: string }

/**
 * Pure projection of already evaluated inventory facts into candidate work packages.
 *
 * A package is never persisted as a copy of its devices, nor treated as an approved
 * upgrade plan. Customer/site/model/observed firmware/plan boundaries remain intact.
 * Multiple distinct required actions may involve the same physical device.
 */
export function buildCandidateWorkPackages(findings: readonly WorkPackageFinding[]): ActionWorkPackage[] {
  const byKey = new Map<string, ActionWorkPackage>()
  const membersByGroup = new Map<string, Set<string>>()

  for (const finding of findings) {
    const candidates: Candidate[] = []
    if (finding.status === 'CRITICAL_ATTENTION') {
      candidates.push({
        kind: 'URGENT',
        label: 'Critical firmware review',
        findingKey: finding.status,
        reason: finding.reason,
        href: rowLink(finding, finding.status),
      })
    } else if (
      (finding.status === 'UPDATE_REQUIRED' || finding.status === 'UPDATE_RECOMMENDED') &&
      !finding.plan
    ) {
      candidates.push({
        kind: 'TO_PLAN',
        label: finding.status === 'UPDATE_REQUIRED' ? 'Required firmware update' : 'Recommended firmware update',
        findingKey: finding.status,
        reason: finding.reason,
        href: rowLink(finding, finding.status),
      })
    } else if (finding.status === 'REVIEW_REQUIRED' || finding.status === 'UNKNOWN') {
      candidates.push({
        kind: 'CHECK',
        label: finding.status === 'REVIEW_REQUIRED' ? 'Firmware review required' : 'Check firmware data',
        findingKey: finding.status,
        reason: finding.reason,
        href: rowLink(finding, finding.status),
      })
    }

    if (finding.plan?.state === 'AWAITING_CUSTOMER') {
      candidates.push({
        kind: 'BLOCKED',
        label: 'Awaiting customer approval',
        findingKey: 'PLAN:' + finding.plan.id,
        reason: 'An existing work plan is awaiting customer approval.',
        href: '/planning/' + encodeURIComponent(finding.plan.id),
      })
    }

    if (!finding.managementContractId) {
      candidates.push({
        kind: 'CHECK',
        label: 'Check management contract',
        findingKey: 'MISSING_CONTRACT',
        reason: 'No effective management contract is registered for this device.',
        href: rowLink(finding) + '&contract=none',
      })
    }

    for (const candidate of candidates) {
      const identity = JSON.stringify([
        candidate.kind,
        candidate.findingKey,
        candidate.reason,
        finding.customer.id,
        finding.site?.id ?? null,
        finding.vendor.id,
        finding.model.id,
        candidate.findingKey === 'MISSING_CONTRACT' ? null : (finding.firmwareKey ?? null),
        finding.managementContractId ?? null,
        // Separate approval/maintenance scopes even within technically similar releases.
        finding.plan?.id ?? null,
      ])
      let group = byKey.get(identity)
      if (!group) {
        group = {
          id: identity,
          kind: candidate.kind,
          findingKey: candidate.findingKey,
          title: candidate.label + ' · ' + finding.vendor.name + ' ' + finding.model.name,
          reason: candidate.reason,
          customer: finding.customer,
          site: finding.site,
          vendor: finding.vendor,
          model: finding.model,
          managementContractId: finding.managementContractId,
          deviceIds: [],
          deviceCount: 0,
          href: candidate.href,
          dueAt: null,
          assigneeId: null,
        }
        byKey.set(identity, group)
        membersByGroup.set(identity, new Set())
      }
      const members = membersByGroup.get(identity)!
      if (!members.has(finding.deviceId)) {
        members.add(finding.deviceId)
        group.deviceIds.push(finding.deviceId)
        group.deviceCount += 1
      }
    }
  }

  return [...byKey.values()]
    .map((group) => ({ ...group, deviceIds: group.deviceIds.sort() }))
    .sort((left, right) =>
      rank[right.kind] - rank[left.kind] ||
      right.deviceCount - left.deviceCount ||
      left.customer.name.localeCompare(right.customer.name, 'en', { sensitivity: 'base' }) ||
      left.title.localeCompare(right.title, 'en', { sensitivity: 'base' }) ||
      left.id.localeCompare(right.id),
    )
}

export function countCandidateWorkPackages(packages: readonly ActionWorkPackage[]) {
  const counts: Record<WorkPackageKind, number> = {
    URGENT: 0,
    TO_PLAN: 0,
    BLOCKED: 0,
    CHECK: 0,
  }
  for (const work of packages) counts[work.kind] += 1
  return counts
}
