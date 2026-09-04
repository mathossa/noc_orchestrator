export const FIRMWARE_POLICY_MODES = ['EXACT', 'MINIMUM', 'RANGE', 'LATEST_APPROVED_IN_TRAIN'] as const
export type FirmwarePolicyMode = (typeof FIRMWARE_POLICY_MODES)[number]

export const FIRMWARE_POLICY_TRACK_CLASSES = ['PREFERRED', 'ACCEPTED', 'LEGACY', 'RESTRICTED'] as const
export type FirmwarePolicyTrackClass = (typeof FIRMWARE_POLICY_TRACK_CLASSES)[number]

export const FIRMWARE_POLICY_SCOPES = ['DEVICE', 'SITE', 'CUSTOMER', 'MODEL', 'FAMILY'] as const
export type FirmwarePolicyScope = (typeof FIRMWARE_POLICY_SCOPES)[number]

export type FirmwarePolicyDeviceContext = {
  deviceId: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  deviceModelFamilyId: string | null
}

export type FirmwarePolicyCandidate = {
  id: string
  isActive: boolean
  policyMode: FirmwarePolicyMode
  trackKey: string
  trackName: string
  trackClass: FirmwarePolicyTrackClass
  isDefaultTrack: boolean
  desiredPlatform: string | null
  minimumFirmwareReleaseId: string | null
  targetFirmwareReleaseId: string | null
  maximumFirmwareReleaseId: string | null
  firmwareTrainId: string | null
  minimumInclusive: boolean
  maximumInclusive: boolean
  effectiveFrom: Date | string
  policyVersion: number
  deviceModelFamilyId: string | null
  deviceModelId: string | null
  customerId: string | null
  siteId: string | null
  deviceId: string | null
  contractTypeId?: string | null
  vendorId?: string | null
  deviceTypeId?: string | null
}

export type FirmwarePolicySource = {
  scope: FirmwarePolicyScope
  scopeId: string
  subject: 'DEVICE' | 'MODEL' | 'FAMILY' | 'UNSCOPED'
  subjectId: string | null
  policyId: string
  policyVersion: number
  trackKey: string
  trackName: string
  trackClass: FirmwarePolicyTrackClass
  effectiveFrom: string
}

export type FirmwarePolicyResolution = {
  status: 'RESOLVED' | 'UNRESOLVED'
  policy: FirmwarePolicyCandidate | null
  source: FirmwarePolicySource | null
  unresolvedReason: 'NO_POLICY' | 'NO_DEFAULT_TRACK' | 'AMBIGUOUS_DEFAULT_TRACK' | null
}

export type FirmwarePolicyTimelineResolution = FirmwarePolicyResolution & {
  next: {
    effectiveFrom: string
    policy: FirmwarePolicyCandidate
    source: FirmwarePolicySource
  } | null
}

function asDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0) : date
}

function subjectRank(policy: FirmwarePolicyCandidate, context: FirmwarePolicyDeviceContext) {
  if (policy.deviceModelId) return policy.deviceModelId === context.deviceModelId ? 2 : -1
  if (policy.deviceModelFamilyId) {
    return context.deviceModelFamilyId && policy.deviceModelFamilyId === context.deviceModelFamilyId ? 1 : -1
  }
  return 0
}

function explicitScope(policy: FirmwarePolicyCandidate, context: FirmwarePolicyDeviceContext) {
  // Contract/vendor/device-type policy columns are retained for migration compatibility,
  // but #43 deliberately does not give them undocumented precedence over the explicit
  // Device > Site > Customer > Model > Family chain.
  if (policy.contractTypeId || policy.vendorId || policy.deviceTypeId) return null

  const subject = subjectRank(policy, context)
  if (subject < 0) return null

  if (policy.deviceId) {
    return policy.deviceId === context.deviceId ? { scope: 'DEVICE' as const, rank: 5, subjectRank: subject } : null
  }
  if (policy.siteId) {
    return context.siteId && policy.siteId === context.siteId ? { scope: 'SITE' as const, rank: 4, subjectRank: subject } : null
  }
  if (policy.customerId) {
    return policy.customerId === context.customerId ? { scope: 'CUSTOMER' as const, rank: 3, subjectRank: subject } : null
  }
  if (policy.deviceModelId) {
    return policy.deviceModelId === context.deviceModelId ? { scope: 'MODEL' as const, rank: 2, subjectRank: 2 } : null
  }
  if (policy.deviceModelFamilyId) {
    return context.deviceModelFamilyId && policy.deviceModelFamilyId === context.deviceModelFamilyId
      ? { scope: 'FAMILY' as const, rank: 1, subjectRank: 1 }
      : null
  }
  return null
}

function newer(left: FirmwarePolicyCandidate, right: FirmwarePolicyCandidate) {
  const dateDelta = asDate(left.effectiveFrom).getTime() - asDate(right.effectiveFrom).getTime()
  if (dateDelta !== 0) return dateDelta > 0
  if (left.policyVersion !== right.policyVersion) return left.policyVersion > right.policyVersion
  return left.id.localeCompare(right.id) > 0
}

function latestVersionPerTrack(candidates: FirmwarePolicyCandidate[]) {
  const byTrack = new Map<string, FirmwarePolicyCandidate>()
  for (const candidate of candidates) {
    const current = byTrack.get(candidate.trackKey)
    if (!current || newer(candidate, current)) byTrack.set(candidate.trackKey, candidate)
  }
  return [...byTrack.values()]
}

function sourceFor(policy: FirmwarePolicyCandidate, scope: FirmwarePolicyScope, context: FirmwarePolicyDeviceContext): FirmwarePolicySource {
  const subject = policy.deviceId
    ? 'DEVICE'
    : policy.deviceModelId
      ? 'MODEL'
      : policy.deviceModelFamilyId
        ? 'FAMILY'
        : 'UNSCOPED'
  const subjectId = policy.deviceId ?? policy.deviceModelId ?? policy.deviceModelFamilyId ?? null
  const scopeId = scope === 'DEVICE'
    ? context.deviceId
    : scope === 'SITE'
      ? context.siteId ?? ''
      : scope === 'CUSTOMER'
        ? context.customerId
        : scope === 'MODEL'
          ? context.deviceModelId
          : context.deviceModelFamilyId ?? ''

  return {
    scope,
    scopeId,
    subject,
    subjectId,
    policyId: policy.id,
    policyVersion: policy.policyVersion,
    trackKey: policy.trackKey,
    trackName: policy.trackName,
    trackClass: policy.trackClass,
    effectiveFrom: asDate(policy.effectiveFrom).toISOString(),
  }
}

export function resolveFirmwarePolicyAt(
  candidates: FirmwarePolicyCandidate[],
  context: FirmwarePolicyDeviceContext,
  at: Date = new Date(),
): FirmwarePolicyResolution {
  const atMs = at.getTime()
  const applicable = candidates
    .filter((policy) => policy.isActive && asDate(policy.effectiveFrom).getTime() <= atMs)
    .map((policy) => ({ policy, scope: explicitScope(policy, context) }))
    .filter((entry): entry is { policy: FirmwarePolicyCandidate; scope: NonNullable<ReturnType<typeof explicitScope>> } => Boolean(entry.scope))

  for (const rank of [5, 4, 3, 2, 1]) {
    const atRank = applicable.filter((entry) => entry.scope.rank === rank)
    if (atRank.length === 0) continue

    const bestSubjectRank = Math.max(...atRank.map((entry) => entry.scope.subjectRank))
    const sameSubject = atRank.filter((entry) => entry.scope.subjectRank === bestSubjectRank)
    const latestTracks = latestVersionPerTrack(sameSubject.map((entry) => entry.policy))
    const defaults = latestTracks.filter((policy) => policy.isDefaultTrack)
    const scope = sameSubject[0].scope.scope

    if (defaults.length > 1) {
      return { status: 'UNRESOLVED', policy: null, source: null, unresolvedReason: 'AMBIGUOUS_DEFAULT_TRACK' }
    }
    if (defaults.length === 0 && latestTracks.length > 1) {
      return { status: 'UNRESOLVED', policy: null, source: null, unresolvedReason: 'NO_DEFAULT_TRACK' }
    }

    const selected = defaults[0] ?? latestTracks[0]
    return {
      status: 'RESOLVED',
      policy: selected,
      source: sourceFor(selected, scope, context),
      unresolvedReason: null,
    }
  }

  return { status: 'UNRESOLVED', policy: null, source: null, unresolvedReason: 'NO_POLICY' }
}

export function resolveFirmwarePolicyTimeline(
  candidates: FirmwarePolicyCandidate[],
  context: FirmwarePolicyDeviceContext,
  at: Date = new Date(),
): FirmwarePolicyTimelineResolution {
  const current = resolveFirmwarePolicyAt(candidates, context, at)
  const futureTimes = [...new Set(
    candidates
      .filter((policy) => policy.isActive && asDate(policy.effectiveFrom).getTime() > at.getTime())
      .map((policy) => asDate(policy.effectiveFrom).getTime()),
  )].sort((a, b) => a - b)

  let next: FirmwarePolicyTimelineResolution['next'] = null
  for (const timestamp of futureTimes) {
    const future = resolveFirmwarePolicyAt(candidates, context, new Date(timestamp))
    if (future.status !== 'RESOLVED' || !future.policy || !future.source) continue
    if (current.status === 'RESOLVED' && current.policy?.id === future.policy.id) continue
    next = {
      effectiveFrom: new Date(timestamp).toISOString(),
      policy: future.policy,
      source: future.source,
    }
    break
  }

  return { ...current, next }
}

export function validateFirmwarePolicyCandidate(policy: FirmwarePolicyCandidate) {
  const errors: string[] = []
  if (!FIRMWARE_POLICY_MODES.includes(policy.policyMode)) errors.push('Unsupported policy mode.')
  if (!FIRMWARE_POLICY_TRACK_CLASSES.includes(policy.trackClass)) errors.push('Unsupported track classification.')
  if (!policy.trackKey.trim()) errors.push('Track key is required.')
  if (!policy.trackName.trim()) errors.push('Track name is required.')
  if (!policy.desiredPlatform?.trim()) errors.push('Desired software platform is required.')
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 1) errors.push('Policy version must be a positive integer.')

  const organizationScopes = [policy.customerId, policy.siteId, policy.deviceId].filter(Boolean).length
  if (organizationScopes > 1) errors.push('Choose only one organizational scope: customer, site, or device.')
  if (policy.deviceModelId && policy.deviceModelFamilyId) errors.push('Choose a model or model family subject, not both.')
  if (!policy.deviceId && !policy.deviceModelId && !policy.deviceModelFamilyId) {
    errors.push('A policy must target a device, concrete model, or model family.')
  }
  if ((policy.customerId || policy.siteId) && !policy.deviceModelId && !policy.deviceModelFamilyId) {
    errors.push('Customer and site policies must target a concrete model or model family.')
  }
  if (policy.contractTypeId || policy.vendorId || policy.deviceTypeId) {
    errors.push('Contract, vendor, and device-type policy scopes are retained for compatibility but are not writable by #43.')
  }

  switch (policy.policyMode) {
    case 'EXACT':
      if (!policy.targetFirmwareReleaseId) errors.push('EXACT policy requires a preferred firmware release.')
      break
    case 'MINIMUM':
      if (!policy.minimumFirmwareReleaseId) errors.push('MINIMUM policy requires a minimum firmware release.')
      if (!policy.targetFirmwareReleaseId) errors.push('MINIMUM policy requires a preferred firmware release.')
      break
    case 'RANGE':
      if (!policy.minimumFirmwareReleaseId && !policy.maximumFirmwareReleaseId) {
        errors.push('RANGE policy requires a minimum and/or maximum firmware release.')
      }
      if (!policy.targetFirmwareReleaseId) errors.push('RANGE policy requires a preferred firmware release.')
      break
    case 'LATEST_APPROVED_IN_TRAIN':
      if (!policy.firmwareTrainId) errors.push('LATEST_APPROVED_IN_TRAIN policy requires an explicit firmware train.')
      break
  }

  return errors
}
