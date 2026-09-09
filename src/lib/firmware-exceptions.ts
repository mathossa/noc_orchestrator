import { compareFirmwareVersions } from '@/lib/firmware-versioning'
import { normalizedFirmwarePlatform } from '@/lib/firmware-releases'
import type { FirmwareComplianceResult } from '@/lib/firmware-compliance'

export const EXCEPTION_SCOPES = [
  'DEVICE',
  'SITE',
  'CUSTOMER',
  'MODEL',
  'FAMILY',
] as const
export const EXCEPTION_SUBJECTS = [
  'RELEASE',
  'RANGE',
  'TRAIN',
  'PLATFORM_MIGRATION',
  'ALL_MAINTENANCE',
  'TEMPORARY_HOLD',
] as const
export const EXCEPTION_DURATIONS = [
  'NEXT_REVIEW',
  'CUSTOM_DATE',
  'UNTIL_EOL',
  'PERMANENT',
  'POLICY_CHANGE',
] as const
export type ExceptionScope = (typeof EXCEPTION_SCOPES)[number]
export type ExceptionInput = {
  scope: ExceptionScope
  scopeId: string
  subject: (typeof EXCEPTION_SUBJECTS)[number]
  reasonCode: string
  notes: string | null
  releaseId: string | null
  vendorId: string | null
  platform: string | null
  minimumVersion: string | null
  maximumVersion: string | null
  trainId: string | null
  fromPlatform: string | null
  toPlatform: string | null
  duration: (typeof EXCEPTION_DURATIONS)[number]
  expiresAt: Date | null
  contactReference: string | null
  ticketReference: string | null
}
export type ExceptionRecord = Omit<
  ExceptionInput,
  'scope' | 'subject' | 'duration' | 'expiresAt'
> & {
  id: string
  scope: string
  subject: string
  duration: string
  scopeLabel: string
  expiresAt: Date | string | null
  decidedAt: Date | string
  supersededAt: Date | string | null
  policySnapshots: unknown
  actorUserId: string | null
}
export type ExceptionDevice = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  deviceModel: { familyId: string | null }
}
export class FirmwareExceptionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}
const text = (value: unknown) =>
  typeof value === 'string' ? value.normalize('NFKC').trim() || null : null
export function nextQuarter(at: Date) {
  const result = new Date(at)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + 3)
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, last))
  return result
}
export function parseExceptionInput(
  raw: unknown,
  at = new Date(),
): ExceptionInput {
  if (!raw || typeof raw !== 'object')
    throw new FirmwareExceptionError('Enter exception details.')
  const b = raw as Record<string, unknown>
  const scope = text(b.scope) as ExceptionInput['scope']
  const subject = text(b.subject) as ExceptionInput['subject']
  const duration = (text(b.duration) ??
    'NEXT_REVIEW') as ExceptionInput['duration']
  if (!EXCEPTION_SCOPES.includes(scope) || !text(b.scopeId))
    throw new FirmwareExceptionError('Choose an exception scope.')
  if (!EXCEPTION_SUBJECTS.includes(subject))
    throw new FirmwareExceptionError('Choose exception coverage.')
  if (!EXCEPTION_DURATIONS.includes(duration))
    throw new FirmwareExceptionError('Choose an expiry mode.')
  const reasonCode = text(b.reasonCode)
  if (!reasonCode) throw new FirmwareExceptionError('Choose a reason.')
  const notes = text(b.notes)
  if (reasonCode === 'OTHER' && !notes)
    throw new FirmwareExceptionError('Other requires notes.')
  for (const [key, value] of Object.entries(b))
    if (
      typeof value === 'string' &&
      value.length > (key === 'notes' ? 5000 : 500)
    )
      throw new FirmwareExceptionError(`${key} is too long.`)
  let expiresAt: Date | null = null
  if (duration === 'NEXT_REVIEW') expiresAt = nextQuarter(at)
  if (['CUSTOM_DATE', 'UNTIL_EOL'].includes(duration)) {
    expiresAt = new Date(text(b.expiresAt) ?? '')
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= at)
      throw new FirmwareExceptionError(
        'Enter a future review/EOL date. Unknown EOL must not become a permanent exception.',
      )
  }
  if (subject === 'RELEASE' && !text(b.releaseId))
    throw new FirmwareExceptionError('Choose the exact release/build.')
  if (subject === 'TRAIN' && !text(b.trainId))
    throw new FirmwareExceptionError('Choose a firmware train.')
  if (
    subject === 'RANGE' &&
    (!text(b.vendorId) ||
      !text(b.platform) ||
      !text(b.minimumVersion) ||
      !text(b.maximumVersion))
  )
    throw new FirmwareExceptionError(
      'A range needs vendor, platform, and both inclusive version bounds.',
    )
  if (subject === 'RANGE') {
    const order = compareFirmwareVersions({
      vendorKey: text(b.vendorId)!,
      platform: text(b.platform)!,
      leftVersion: text(b.minimumVersion)!,
      rightVersion: text(b.maximumVersion)!,
    }).result
    if (!['LESS', 'EQUAL'].includes(order))
      throw new FirmwareExceptionError(
        'The range must be comparable and its minimum must not exceed its maximum.',
      )
  }
  if (
    subject === 'PLATFORM_MIGRATION' &&
    (!text(b.fromPlatform) ||
      !text(b.toPlatform) ||
      normalizedFirmwarePlatform(text(b.fromPlatform)!) ===
        normalizedFirmwarePlatform(text(b.toPlatform)!))
  )
    throw new FirmwareExceptionError(
      'Enter different source and destination platforms.',
    )
  return {
    scope,
    scopeId: text(b.scopeId)!,
    subject,
    reasonCode,
    notes,
    duration,
    expiresAt,
    releaseId: subject === 'RELEASE' ? text(b.releaseId) : null,
    vendorId: subject === 'RANGE' ? text(b.vendorId) : null,
    platform: subject === 'RANGE' ? text(b.platform) : null,
    minimumVersion: subject === 'RANGE' ? text(b.minimumVersion) : null,
    maximumVersion: subject === 'RANGE' ? text(b.maximumVersion) : null,
    trainId: subject === 'TRAIN' ? text(b.trainId) : null,
    fromPlatform:
      subject === 'PLATFORM_MIGRATION' ? text(b.fromPlatform) : null,
    toPlatform: subject === 'PLATFORM_MIGRATION' ? text(b.toPlatform) : null,
    contactReference: text(b.contactReference),
    ticketReference: text(b.ticketReference),
  }
}
export function exceptionScopeMatches(
  row: Pick<ExceptionRecord, 'scope' | 'scopeId'>,
  device: ExceptionDevice,
) {
  const ids: Record<string, string | null> = {
    DEVICE: device.id,
    SITE: device.siteId,
    CUSTOMER: device.customerId,
    MODEL: device.deviceModelId,
    FAMILY: device.deviceModel.familyId,
  }
  return ids[row.scope] != null && ids[row.scope] === row.scopeId
}
export function policyFingerprint(result: FirmwareComplianceResult) {
  const p = result.effectivePolicy.policy
  return JSON.stringify([
    p?.id,
    p?.policyVersion,
    p?.policyMode,
    p?.minimumFirmwareReleaseId,
    p?.maximumFirmwareReleaseId,
    p?.minimumInclusive,
    p?.maximumInclusive,
    p?.desiredPlatform,
    p?.trackKey,
    result.preferredTarget?.id,
    result.resolvedTarget?.id,
  ])
}
export function exceptionStatus(
  row: ExceptionRecord,
  deviceId: string,
  result: FirmwareComplianceResult,
  at: Date,
) {
  if (row.supersededAt && new Date(row.supersededAt) <= at) return 'SUPERSEDED'
  if (new Date(row.decidedAt) > at) return 'NOT_YET_ACTIVE'
  if (row.expiresAt && new Date(row.expiresAt) <= at) return 'EXPIRED'
  if (row.duration === 'POLICY_CHANGE') {
    const snapshots = row.policySnapshots as Record<string, string> | null
    if (!snapshots || snapshots[deviceId] !== policyFingerprint(result))
      return 'POLICY_CHANGED'
  }
  return 'ACTIVE'
}
export function exceptionSubjectMatches(
  row: ExceptionRecord,
  result: FirmwareComplianceResult,
) {
  const target = result.resolvedTarget ?? result.preferredTarget
  switch (row.subject) {
    case 'ALL_MAINTENANCE':
    case 'TEMPORARY_HOLD':
      return true
    case 'RELEASE':
      return !!target && target.id === row.releaseId
    case 'TRAIN':
      return !!target && target.firmwareTrainId === row.trainId
    case 'PLATFORM_MIGRATION':
      return (
        result.recommendation === 'PLATFORM_MIGRATION' &&
        normalizedFirmwarePlatform(result.currentFirmware?.platform ?? '') ===
          normalizedFirmwarePlatform(row.fromPlatform ?? '') &&
        normalizedFirmwarePlatform(target?.platform ?? '') ===
          normalizedFirmwarePlatform(row.toPlatform ?? '')
      )
    case 'RANGE': {
      if (
        !target ||
        target.vendorId !== row.vendorId ||
        normalizedFirmwarePlatform(target.platform) !==
          normalizedFirmwarePlatform(row.platform ?? '') ||
        !row.minimumVersion ||
        !row.maximumVersion
      )
        return false
      const compare = (version: string) =>
        compareFirmwareVersions({
          vendorKey: target.vendorId,
          platform: target.platform,
          leftVersion: target.version,
          rightVersion: version,
        }).result
      return (
        ['GREATER', 'EQUAL'].includes(compare(row.minimumVersion)) &&
        ['LESS', 'EQUAL'].includes(compare(row.maximumVersion))
      )
    }
    default:
      return false
  }
}
export function resolveFirmwareExceptions(
  rows: ExceptionRecord[],
  device: ExceptionDevice,
  technical: FirmwareComplianceResult,
  at = new Date(),
) {
  const records = rows
    .filter((row) => exceptionScopeMatches(row, device))
    .map((row) => ({
      ...row,
      status: exceptionStatus(row, device.id, technical, at),
      subjectMatches: exceptionSubjectMatches(row, technical),
    }))
  const applicable = records
    .filter((row) => row.status === 'ACTIVE' && row.subjectMatches)
    .sort(
      (a, b) =>
        EXCEPTION_SCOPES.indexOf(a.scope as ExceptionScope) -
          EXCEPTION_SCOPES.indexOf(b.scope as ExceptionScope) ||
        new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime() ||
        a.id.localeCompare(b.id),
    )
  const selected =
    technical.recommendation === 'NO_ACTION' ? null : (applicable[0] ?? null)
  return {
    technical,
    operationalRecommendation: selected
      ? 'ACCEPTED_EXCEPTION'
      : technical.recommendation,
    selected,
    applicable,
    records,
  }
}
