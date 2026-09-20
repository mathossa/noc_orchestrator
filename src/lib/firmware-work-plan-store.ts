import { createHash } from 'node:crypto'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveFirmwareComplianceBatch } from '@/lib/firmware-compliance-store'
import {
  policyFingerprint,
  resolveFirmwareExceptions,
  type ExceptionRecord,
} from '@/lib/firmware-exceptions'
import {
  assertFirmwareWorkPlanTransition,
  FIRMWARE_WORK_PLAN_STATES,
  FIRMWARE_UPGRADE_CAPABILITIES,
  type FirmwareWorkPlanState,
  type FirmwareUpgradeCapability,
} from '@/lib/firmware-work-planning'

type Db = Prisma.TransactionClient

type TransitionContext = {
  expectedState: FirmwareWorkPlanState
  /** The updatedAt returned by the last read; prevents stale/ABA writes. */
  expectedUpdatedAt: Date
  actorUserId?: string | null
  reason?: string | null
  notes?: string | null
}

export type ScheduleFirmwareWorkPlanInput = TransitionContext & {
  scheduledFor?: Date
  maintenanceWindowReference?: string | null
}

export type TransitionFirmwareWorkPlanInput = TransitionContext &
  (
    | {
        toState: Exclude<FirmwareWorkPlanState, 'SCHEDULED'>
        scheduledFor?: never
        maintenanceWindowReference?: never
      }
    | {
        toState: 'SCHEDULED'
        scheduledFor?: Date
        maintenanceWindowReference?: string | null
      }
  )

export type AmendFirmwareWorkPlanProposalInput = TransitionContext & {
  proposedFor?: Date | null
  proposedMaintenanceWindowReference?: string | null
}

/** Scheduling records domain intent only; it does not enqueue or execute work. */
export function scheduleFirmwareWorkPlan(
  id: string,
  input: ScheduleFirmwareWorkPlanInput,
) {
  return transitionFirmwareWorkPlan(id, { ...input, toState: 'SCHEDULED' })
}

export async function transitionFirmwareWorkPlan(
  id: string,
  input: TransitionFirmwareWorkPlanInput,
) {
  if (
    !FIRMWARE_WORK_PLAN_STATES.includes(input.expectedState) ||
    !FIRMWARE_WORK_PLAN_STATES.includes(input.toState)
  )
    throw new FirmwareWorkPlanError('Unknown firmware work plan state.')
  if (
    !(input.expectedUpdatedAt instanceof Date) ||
    !Number.isFinite(input.expectedUpdatedAt.getTime())
  )
    throw new FirmwareWorkPlanError('A valid expectedUpdatedAt is required.')
  if (input.toState === 'SCHEDULED') {
    if (
      input.scheduledFor !== undefined &&
      (!(input.scheduledFor instanceof Date) ||
        !Number.isFinite(input.scheduledFor.getTime()))
    )
      throw new FirmwareWorkPlanError(
        'SCHEDULED work requires a valid scheduledFor date.',
      )
  } else if (
    input.scheduledFor !== undefined ||
    input.maintenanceWindowReference !== undefined
  ) {
    throw new FirmwareWorkPlanError(
      'Scheduling fields may only be supplied when entering SCHEDULED.',
    )
  }
  const reason = text(input.reason, 500)
  const notes = text(input.notes, 5000)
  const actorUserId = input.actorUserId ?? null
  const requestedMaintenanceWindowReference =
    input.toState === 'SCHEDULED' &&
    input.maintenanceWindowReference !== undefined
      ? text(input.maintenanceWindowReference, 500)
      : undefined

  return prisma.$transaction(
    async (tx) => {
      const plan = await tx.firmwareWorkPlan.findUnique({ where: { id } })
      if (!plan)
        throw new FirmwareWorkPlanError(
          'Firmware work plan was not found.',
          404,
        )
      if (
        plan.state !== input.expectedState ||
        plan.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      )
        throw new FirmwareWorkPlanError(
          'Work plan changed. Reload before transitioning.',
          409,
        )
      assertFirmwareWorkPlanTransition(input.expectedState, input.toState)

      let confirmedScheduledFor: Date | null = null
      let confirmedMaintenanceWindowReference: string | null = null
      if (input.toState === 'SCHEDULED') {
        confirmedScheduledFor = input.scheduledFor ?? plan.proposedFor
        if (
          !(confirmedScheduledFor instanceof Date) ||
          !Number.isFinite(confirmedScheduledFor.getTime())
        )
          throw new FirmwareWorkPlanError(
            'SCHEDULED work requires a valid scheduledFor date or stored proposedFor date.',
          )

        confirmedMaintenanceWindowReference =
          requestedMaintenanceWindowReference ??
          plan.proposedMaintenanceWindowReference

        if (
          plan.proposedFor &&
          (plan.proposedFor.getTime() !== confirmedScheduledFor.getTime() ||
            plan.proposedMaintenanceWindowReference !==
              confirmedMaintenanceWindowReference)
        )
          throw new FirmwareWorkPlanError(
            'Scheduling must confirm the exact proposed maintenance window. Amend the proposal first if the window changed.',
            409,
          )
        if (plan.state === 'AWAITING_CUSTOMER' && !plan.proposedFor)
          throw new FirmwareWorkPlanError(
            'Customer approval may schedule directly only when a proposed maintenance date is already stored.',
            409,
          )
      }

      const at = new Date()
      const data: Prisma.FirmwareWorkPlanUpdateManyMutationInput = {
        state: input.toState,
        // PostgreSQL stores millisecond precision. Advance even for same-ms writes.
        updatedAt: new Date(
          Math.max(at.getTime(), plan.updatedAt.getTime() + 1),
        ),
      }
      switch (input.toState) {
        case 'PROPOSED':
          Object.assign(data, {
            approvedAt: null,
            approvedByUserId: null,
            scheduledAt: null,
            scheduledFor: null,
            maintenanceWindowReference: null,
          })
          break
        case 'APPROVED':
          Object.assign(data, {
            approvedAt: at,
            approvedByUserId: actorUserId,
            scheduledAt: null,
            scheduledFor: null,
            maintenanceWindowReference: null,
          })
          break
        case 'SCHEDULED':
          Object.assign(data, {
            ...(plan.state === 'AWAITING_CUSTOMER'
              ? { approvedAt: at, approvedByUserId: actorUserId }
              : {}),
            scheduledAt: at,
            scheduledFor: confirmedScheduledFor,
            maintenanceWindowReference: confirmedMaintenanceWindowReference,
          })
          break
        case 'IN_PROGRESS':
          data.startedAt = at
          break
        case 'DONE':
          data.completedAt = at
          break
        case 'CANCELLED':
          data.cancelledAt = at
          break
      }
      // ReadCommitted rechecks this predicate after any competing row writer commits.
      // All writers must use this operation; no automatic retry of stale user intent.
      const changed = await tx.firmwareWorkPlan.updateMany({
        where: {
          id,
          state: input.expectedState,
          updatedAt: input.expectedUpdatedAt,
        },
        data,
      })
      if (changed.count !== 1)
        throw new FirmwareWorkPlanError(
          'Work plan changed. Reload before transitioning.',
          409,
        )
      const next = await tx.firmwareWorkPlan.findUniqueOrThrow({
        where: { id },
      })
      const history = (row: typeof plan) => ({
        state: row.state,
        proposedFor: row.proposedFor?.toISOString() ?? null,
        proposedMaintenanceWindowReference:
          row.proposedMaintenanceWindowReference,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        approvedByUserId: row.approvedByUserId,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
        scheduledFor: row.scheduledFor?.toISOString() ?? null,
        maintenanceWindowReference: row.maintenanceWindowReference,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
      })
      const before = history(plan)
      const after = history(next)
      await tx.firmwareWorkPlanEvent.create({
        data: {
          planId: id,
          fromState: plan.state,
          toState: next.state,
          actorUserId,
          reason,
          notes,
          createdAt: at,
          metadata: { before, after },
        },
      })
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'FIRMWARE_WORK_PLAN_TRANSITIONED',
          entityType: 'FirmwareWorkPlan',
          entityId: id,
          before,
          after,
          metadata: { reason, notes },
          createdAt: at,
        },
      })
      return next
    },
    { isolationLevel: 'ReadCommitted' },
  )
}

const AMENDABLE_PROPOSAL_STATES = new Set<FirmwareWorkPlanState>([
  'PROPOSED',
  'AWAITING_CUSTOMER',
  'APPROVED',
])

export async function amendFirmwareWorkPlanProposal(
  id: string,
  input: AmendFirmwareWorkPlanProposalInput,
) {
  if (!FIRMWARE_WORK_PLAN_STATES.includes(input.expectedState))
    throw new FirmwareWorkPlanError('Unknown firmware work plan state.')
  if (
    !(input.expectedUpdatedAt instanceof Date) ||
    !Number.isFinite(input.expectedUpdatedAt.getTime())
  )
    throw new FirmwareWorkPlanError('A valid expectedUpdatedAt is required.')

  const hasProposedFor = Object.prototype.hasOwnProperty.call(
    input,
    'proposedFor',
  )
  const hasWindowReference = Object.prototype.hasOwnProperty.call(
    input,
    'proposedMaintenanceWindowReference',
  )
  if (!hasProposedFor && !hasWindowReference)
    throw new FirmwareWorkPlanError(
      'Provide a proposed maintenance date/time or window reference to amend.',
    )
  if (
    hasProposedFor &&
    input.proposedFor !== null &&
    (!(input.proposedFor instanceof Date) ||
      !Number.isFinite(input.proposedFor.getTime()))
  )
    throw new FirmwareWorkPlanError('proposedFor must be a valid date or null.')

  const proposedMaintenanceWindowReference = hasWindowReference
    ? text(input.proposedMaintenanceWindowReference, 500)
    : undefined
  const reason = text(input.reason, 500)
  const notes = text(input.notes, 5000)
  const actorUserId = input.actorUserId ?? null

  return prisma.$transaction(
    async (tx) => {
      const plan = await tx.firmwareWorkPlan.findUnique({ where: { id } })
      if (!plan)
        throw new FirmwareWorkPlanError(
          'Firmware work plan was not found.',
          404,
        )
      if (
        plan.state !== input.expectedState ||
        plan.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      )
        throw new FirmwareWorkPlanError(
          'Work plan changed. Reload before transitioning.',
          409,
        )
      if (!AMENDABLE_PROPOSAL_STATES.has(input.expectedState))
        throw new FirmwareWorkPlanError(
          'The proposed maintenance window may only be amended before scheduling.',
          409,
        )

      const at = new Date()
      const data: Prisma.FirmwareWorkPlanUpdateManyMutationInput = {
        ...(hasProposedFor
          ? { proposedFor: input.proposedFor ?? null }
          : {}),
        ...(hasWindowReference
          ? { proposedMaintenanceWindowReference }
          : {}),
        updatedAt: new Date(
          Math.max(at.getTime(), plan.updatedAt.getTime() + 1),
        ),
      }
      const changed = await tx.firmwareWorkPlan.updateMany({
        where: {
          id,
          state: input.expectedState,
          updatedAt: input.expectedUpdatedAt,
        },
        data,
      })
      if (changed.count !== 1)
        throw new FirmwareWorkPlanError(
          'Work plan changed. Reload before transitioning.',
          409,
        )

      const next = await tx.firmwareWorkPlan.findUniqueOrThrow({
        where: { id },
      })
      const history = (row: typeof plan) => ({
        state: row.state,
        proposedFor: row.proposedFor?.toISOString() ?? null,
        proposedMaintenanceWindowReference:
          row.proposedMaintenanceWindowReference,
        scheduledFor: row.scheduledFor?.toISOString() ?? null,
        maintenanceWindowReference: row.maintenanceWindowReference,
      })
      const before = history(plan)
      const after = history(next)
      await tx.firmwareWorkPlanEvent.create({
        data: {
          planId: id,
          fromState: plan.state,
          toState: next.state,
          actorUserId,
          reason,
          notes,
          createdAt: at,
          metadata: {
            kind: 'PROPOSED_MAINTENANCE_WINDOW_AMENDED',
            before,
            after,
          },
        },
      })
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'FIRMWARE_WORK_PLAN_PROPOSED_WINDOW_AMENDED',
          entityType: 'FirmwareWorkPlan',
          entityId: id,
          before,
          after,
          metadata: { reason, notes },
          createdAt: at,
        },
      })
      return next
    },
    { isolationLevel: 'ReadCommitted' },
  )
}

const ACTIVE_PLAN_STATES = [
  'PROPOSED',
  'AWAITING_CUSTOMER',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
] as const

const deviceSelect = {
  id: true,
  name: true,
  isActive: true,
  customerId: true,
  siteId: true,
  deviceModelId: true,
  currentFirmwareReleaseId: true,
  currentFirmwareObservedAt: true,
  currentFirmwareRawVersion: true,
  currentFirmwareNormalizedVersion: true,
  customer: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  deviceModel: {
    select: { id: true, model: true, familyId: true },
  },
} as const

type SelectedDevice = Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>

export type FirmwareWorkPlanPreviewDisposition =
  | 'INCLUDED'
  | 'INACTIVE_DEVICE'
  | 'ALREADY_PLANNED'
  | 'ACTIVE_EXCEPTION'
  | 'NO_ACTION'
  | 'REVIEW_REQUIRED'

export type FirmwareWorkPlanInput = {
  deviceIds: string[]
  title: string | null
  reason: string | null
  notes: string | null
  proposedFor: Date | null
  proposedMaintenanceWindowReference: string | null
  exceptionOverrideDeviceIds: string[]
  upgradeCapability: FirmwareUpgradeCapability
}

export type FirmwareWorkPlanPreviewTarget = {
  deviceId: string
  deviceName: string
  customerId: string
  customerName: string
  siteId: string | null
  siteName: string | null
  deviceModelId: string
  deviceModelName: string
  disposition: FirmwareWorkPlanPreviewDisposition
  detail: string
  activePlanId: string | null
  effectiveExceptionId: string | null
  effectiveExceptionReason: string | null
  exceptionOverride: boolean
  recommendation: string
  observedFirmwareReleaseId: string | null
  observedFirmwareVersion: string | null
  observedFirmwareRawVersion: string | null
  observedFirmwareFingerprint: string | null
  observedAt: string | null
  policyId: string | null
  policyScope: string | null
  policyTrackKey: string | null
  policyTrackName: string | null
  policyVersion: number | null
  policyFingerprint: string | null
  preferredTargetFirmwareReleaseId: string | null
  preferredTargetVersion: string | null
  targetFirmwareReleaseId: string | null
  targetVersion: string | null
  targetLogicalVersion: string | null
  targetPlatform: string | null
  targetVariant: string | null
  targetImageCode: string | null
  compatibilityStatus: string | null
  exceptionSnapshot: Record<string, unknown> | null
  logicalGroupKey: string | null
  memberSnapshot: Record<string, unknown> | null
  upgradeCapability: FirmwareUpgradeCapability
}

export class FirmwareWorkPlanError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'FirmwareWorkPlanError'
  }
}

function text(value: unknown, max: number) {
  if (value == null || value === '') return null
  if (typeof value !== 'string')
    throw new FirmwareWorkPlanError('Planning text fields must be strings.')
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) return null
  if (normalized.length > max)
    throw new FirmwareWorkPlanError(`Planning text may not exceed ${max} characters.`)
  return normalized
}

function optionalPlanningInstant(value: unknown, field: string) {
  if (value == null || value === '') return null
  if (typeof value !== 'string')
    throw new FirmwareWorkPlanError(
      `${field} must be an ISO 8601 timestamp.`,
    )
  const normalized = value.trim()
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized))
    throw new FirmwareWorkPlanError(
      `${field} must include an explicit timezone.`,
    )
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime()))
    throw new FirmwareWorkPlanError(`${field} must be a valid timestamp.`)
  return parsed
}

export function parseFirmwareWorkPlanInput(raw: unknown): FirmwareWorkPlanInput {
  if (!raw || typeof raw !== 'object')
    throw new FirmwareWorkPlanError('Select devices to plan.')

  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0)
    throw new FirmwareWorkPlanError('Select at least one device.')

  const deviceIds = [
    ...new Set(
      body.deviceIds.map((value) => {
        if (typeof value !== 'string' || !value.trim())
          throw new FirmwareWorkPlanError('Device identifiers must be non-empty strings.')
        return value.trim()
      }),
    ),
  ].sort()
  if (deviceIds.length > 20_000)
    throw new FirmwareWorkPlanError('A single planning preview may contain at most 20,000 devices.')

  const overrideRaw = Array.isArray(body.exceptionOverrideDeviceIds)
    ? body.exceptionOverrideDeviceIds
    : []
  const exceptionOverrideDeviceIds = [
    ...new Set(
      overrideRaw.map((value) => {
        if (typeof value !== 'string' || !value.trim())
          throw new FirmwareWorkPlanError('Exception override identifiers must be non-empty strings.')
        return value.trim()
      }),
    ),
  ].sort()

  const selected = new Set(deviceIds)
  if (exceptionOverrideDeviceIds.some((id) => !selected.has(id)))
    throw new FirmwareWorkPlanError('Exception overrides must refer to selected devices.')

  const upgradeCapability =
    typeof body.upgradeCapability === 'string'
      ? (body.upgradeCapability.trim().toUpperCase() as FirmwareUpgradeCapability)
      : 'UNKNOWN'
  if (!FIRMWARE_UPGRADE_CAPABILITIES.includes(upgradeCapability))
    throw new FirmwareWorkPlanError('Choose a supported upgrade capability.')

  return {
    deviceIds,
    title: text(body.title, 200),
    reason: text(body.reason, 500),
    notes: text(body.notes, 5000),
    proposedFor: optionalPlanningInstant(body.proposedFor, 'proposedFor'),
    proposedMaintenanceWindowReference: text(
      body.proposedMaintenanceWindowReference,
      500,
    ),
    exceptionOverrideDeviceIds,
    upgradeCapability,
  }
}

function observedFingerprint(device: SelectedDevice, canonicalId: string | null) {
  const values = [
    canonicalId,
    device.currentFirmwareReleaseId,
    device.currentFirmwareNormalizedVersion,
    device.currentFirmwareRawVersion,
    device.currentFirmwareObservedAt?.toISOString() ?? null,
  ]
  return values.every((value) => value == null) ? null : JSON.stringify(values)
}

function matchingExceptionRows(
  rows: ExceptionRecord[],
  device: SelectedDevice,
) {
  return rows.filter((row) => {
    switch (row.scope) {
      case 'DEVICE':
        return row.scopeId === device.id
      case 'SITE':
        return !!device.siteId && row.scopeId === device.siteId
      case 'CUSTOMER':
        return row.scopeId === device.customerId
      case 'MODEL':
        return row.scopeId === device.deviceModelId
      case 'FAMILY':
        return !!device.deviceModel.familyId && row.scopeId === device.deviceModel.familyId
      default:
        return false
    }
  })
}

async function buildFirmwareWorkPlanPreview(
  db: Db,
  raw: unknown,
  at: Date,
) {
  const input = parseFirmwareWorkPlanInput(raw)
  const devices = await db.device.findMany({
    where: { id: { in: input.deviceIds } },
    select: deviceSelect,
    orderBy: { id: 'asc' },
  })

  if (devices.length !== input.deviceIds.length) {
    const found = new Set(devices.map((device) => device.id))
    const missing = input.deviceIds.filter((id) => !found.has(id))
    throw new FirmwareWorkPlanError(
      `Selected device(s) were not found: ${missing.join(', ')}.`,
      404,
    )
  }

  const customerIds = [...new Set(devices.map((device) => device.customerId))]
  const siteIds = [...new Set(devices.flatMap((device) => (device.siteId ? [device.siteId] : [])))]
  const modelIds = [...new Set(devices.map((device) => device.deviceModelId))]
  const familyIds = [
    ...new Set(
      devices.flatMap((device) =>
        device.deviceModel.familyId ? [device.deviceModel.familyId] : [],
      ),
    ),
  ]

  const exceptionScopes: Prisma.FirmwareExceptionWhereInput[] = [
    { scope: 'DEVICE', scopeId: { in: input.deviceIds } },
    { scope: 'CUSTOMER', scopeId: { in: customerIds } },
    { scope: 'MODEL', scopeId: { in: modelIds } },
  ]
  if (siteIds.length)
    exceptionScopes.push({ scope: 'SITE', scopeId: { in: siteIds } })
  if (familyIds.length)
    exceptionScopes.push({ scope: 'FAMILY', scopeId: { in: familyIds } })

  const [technicalByDevice, exceptionRows, activeTargets] = await Promise.all([
    resolveFirmwareComplianceBatch(input.deviceIds, at, db),
    db.firmwareException.findMany({
      where: { OR: exceptionScopes },
      orderBy: { decidedAt: 'desc' },
    }),
    db.firmwareWorkPlanTarget.findMany({
      where: {
        deviceId: { in: input.deviceIds },
        plan: { state: { in: [...ACTIVE_PLAN_STATES] } },
      },
      select: { deviceId: true, planId: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const activePlanByDevice = new Map<string, string>()
  for (const row of activeTargets)
    if (!activePlanByDevice.has(row.deviceId))
      activePlanByDevice.set(row.deviceId, row.planId)

  const overrides = new Set(input.exceptionOverrideDeviceIds)
  const targets: FirmwareWorkPlanPreviewTarget[] = devices.map((device) => {
    const technical = technicalByDevice.get(device.id)
    if (!technical)
      throw new FirmwareWorkPlanError(
        `Firmware compliance could not be resolved for ${device.name}.`,
        409,
      )

    const exception = resolveFirmwareExceptions(
      matchingExceptionRows(exceptionRows as ExceptionRecord[], device),
      {
        id: device.id,
        customerId: device.customerId,
        siteId: device.siteId,
        deviceModelId: device.deviceModelId,
        deviceModel: { familyId: device.deviceModel.familyId },
      },
      technical,
      at,
    )
    const activePlanId = activePlanByDevice.get(device.id) ?? null
    const override = overrides.has(device.id)
    const resolved = technical.resolvedTarget
    const preferred = technical.preferredTarget
    const source = technical.policySource
    const policy = technical.effectivePolicy.policy
    const observedVersion =
      technical.currentFirmware?.version ??
      device.currentFirmwareNormalizedVersion ??
      device.currentFirmwareRawVersion ??
      null
    const observed = observedFingerprint(
      device,
      technical.currentFirmware?.id ?? null,
    )

    let disposition: FirmwareWorkPlanPreviewDisposition = 'INCLUDED'
    let detail = 'Ready to include in a firmware work plan.'

    if (!device.isActive) {
      disposition = 'INACTIVE_DEVICE'
      detail = 'Archived/inactive devices are not included in new work.'
    } else if (activePlanId) {
      disposition = 'ALREADY_PLANNED'
      detail = 'Device already belongs to an active firmware work plan.'
    } else if (technical.recommendation === 'NO_ACTION') {
      disposition = 'NO_ACTION'
      detail = 'Current technical recommendation requires no firmware action.'
    } else if (exception.selected && !override) {
      disposition = 'ACTIVE_EXCEPTION'
      detail = 'An active accepted exception prevents silent planning.'
    } else if (
      !['UPDATE_REQUIRED', 'UPDATE_RECOMMENDED', 'PLATFORM_MIGRATION'].includes(
        technical.recommendation,
      ) ||
      !resolved ||
      technical.targetCompatibility?.status !== 'RESOLVED'
    ) {
      disposition = 'REVIEW_REQUIRED'
      detail = technical.explanation
    }

    const exceptionSnapshot = exception.selected
      ? {
          id: exception.selected.id,
          reasonCode: exception.selected.reasonCode,
          scope: exception.selected.scope,
          scopeId: exception.selected.scopeId,
          scopeLabel: exception.selected.scopeLabel,
          subject: exception.selected.subject,
          duration: exception.selected.duration,
          expiresAt: exception.selected.expiresAt
            ? new Date(exception.selected.expiresAt).toISOString()
            : null,
        }
      : null

    return {
      deviceId: device.id,
      deviceName: device.name,
      customerId: device.customerId,
      customerName: device.customer.name,
      siteId: device.siteId,
      siteName: device.site?.name ?? null,
      deviceModelId: device.deviceModelId,
      deviceModelName: device.deviceModel.model,
      disposition,
      detail,
      activePlanId,
      effectiveExceptionId: exception.selected?.id ?? null,
      effectiveExceptionReason: exception.selected?.reasonCode ?? null,
      exceptionOverride: Boolean(exception.selected && override),
      recommendation: technical.recommendation,
      observedFirmwareReleaseId: technical.currentFirmware?.id ?? null,
      observedFirmwareVersion: observedVersion,
      observedFirmwareRawVersion: device.currentFirmwareRawVersion,
      observedFirmwareFingerprint: observed,
      observedAt: device.currentFirmwareObservedAt?.toISOString() ?? null,
      policyId: source?.policyId ?? policy?.id ?? null,
      policyScope: source?.scope ?? null,
      policyTrackKey: source?.trackKey ?? policy?.trackKey ?? null,
      policyTrackName: source?.trackName ?? policy?.trackName ?? null,
      policyVersion: source?.policyVersion ?? policy?.policyVersion ?? null,
      policyFingerprint: policy ? policyFingerprint(technical) : null,
      preferredTargetFirmwareReleaseId: preferred?.id ?? null,
      preferredTargetVersion: preferred?.version ?? null,
      targetFirmwareReleaseId: resolved?.id ?? null,
      targetVersion: resolved?.version ?? null,
      targetLogicalVersion: resolved?.logicalVersion ?? null,
      targetPlatform: resolved?.platform ?? null,
      targetVariant: resolved?.variant ?? null,
      targetImageCode: resolved?.imageCode ?? null,
      compatibilityStatus: technical.targetCompatibility?.status ?? null,
      exceptionSnapshot,
      logicalGroupKey: null,
      memberSnapshot: null,
      upgradeCapability: input.upgradeCapability,
    }
  })

  const included = targets.filter((target) => target.disposition === 'INCLUDED')
  const targetDistribution = [
    ...included.reduce(
      (map, target) => {
        const id = target.targetFirmwareReleaseId!
        const current = map.get(id)
        if (current) current.count += 1
        else
          map.set(id, {
            firmwareReleaseId: id,
            platform: target.targetPlatform!,
            version: target.targetVersion!,
            imageCode: target.targetImageCode,
            count: 1,
          })
        return map
      },
      new Map<
        string,
        {
          firmwareReleaseId: string
          platform: string
          version: string
          imageCode: string | null
          count: number
        }
      >(),
    ).values(),
  ].sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) ||
      a.version.localeCompare(b.version) ||
      a.firmwareReleaseId.localeCompare(b.firmwareReleaseId),
  )

  const counts = {
    requested: targets.length,
    included: included.length,
    inactive: targets.filter((target) => target.disposition === 'INACTIVE_DEVICE').length,
    alreadyPlanned: targets.filter((target) => target.disposition === 'ALREADY_PLANNED').length,
    activeException: targets.filter((target) => target.disposition === 'ACTIVE_EXCEPTION').length,
    noAction: targets.filter((target) => target.disposition === 'NO_ACTION').length,
    reviewRequired: targets.filter((target) => target.disposition === 'REVIEW_REQUIRED').length,
    exceptionOverrides: targets.filter((target) => target.exceptionOverride).length,
  }

  const token = createHash('sha256')
    .update(
      JSON.stringify({
        input,
        targets: targets.map((target) => ({
          deviceId: target.deviceId,
          disposition: target.disposition,
          activePlanId: target.activePlanId,
          effectiveExceptionId: target.effectiveExceptionId,
          exceptionOverride: target.exceptionOverride,
          recommendation: target.recommendation,
          observedFirmwareFingerprint: target.observedFirmwareFingerprint,
          policyFingerprint: target.policyFingerprint,
          preferredTargetFirmwareReleaseId:
            target.preferredTargetFirmwareReleaseId,
          targetFirmwareReleaseId: target.targetFirmwareReleaseId,
          compatibilityStatus: target.compatibilityStatus,
        })),
      }),
    )
    .digest('hex')

  return {
    input,
    token,
    counts,
    targetDistribution,
    targets,
  }
}

export async function previewFirmwareWorkPlan(raw: unknown) {
  return prisma.$transaction(
    (tx) => buildFirmwareWorkPlanPreview(tx, raw, new Date()),
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  )
}

export async function createFirmwareWorkPlan(
  raw: unknown,
  token: string,
  actorUserId: string | null = null,
) {
  return prisma.$transaction(
    async (tx) => {
      const preview = await buildFirmwareWorkPlanPreview(tx, raw, new Date())
      if (!token || token !== preview.token)
        throw new FirmwareWorkPlanError(
          'Inventory, policy, exception, compatibility, or planning state changed. Preview the work again before saving.',
          409,
        )

      const included = preview.targets.filter(
        (target) => target.disposition === 'INCLUDED',
      )
      if (included.length === 0)
        throw new FirmwareWorkPlanError(
          'No selected devices are currently eligible for this work plan.',
          409,
        )

      const plan = await tx.firmwareWorkPlan.create({
        data: {
          state: 'PROPOSED',
          title: preview.input.title,
          reason: preview.input.reason,
          notes: preview.input.notes,
          proposedFor: preview.input.proposedFor,
          proposedMaintenanceWindowReference:
            preview.input.proposedMaintenanceWindowReference,
          upgradeCapability: preview.input.upgradeCapability,
          createdByUserId: actorUserId,
          targets: {
            create: included.map((target) => ({
              deviceId: target.deviceId,
              deviceName: target.deviceName,
              customerId: target.customerId,
              customerName: target.customerName,
              siteId: target.siteId,
              siteName: target.siteName,
              deviceModelId: target.deviceModelId,
              deviceModelName: target.deviceModelName,
              logicalGroupKey: target.logicalGroupKey,
              observedFirmwareReleaseId: target.observedFirmwareReleaseId,
              observedFirmwareVersion: target.observedFirmwareVersion,
              observedFirmwareRawVersion: target.observedFirmwareRawVersion,
              observedFirmwareFingerprint:
                target.observedFirmwareFingerprint,
              observedAt: target.observedAt
                ? new Date(target.observedAt)
                : null,
              policyId: target.policyId,
              policyScope: target.policyScope,
              policyTrackKey: target.policyTrackKey,
              policyTrackName: target.policyTrackName,
              policyVersion: target.policyVersion,
              policyFingerprint: target.policyFingerprint,
              recommendation: target.recommendation,
              preferredTargetFirmwareReleaseId:
                target.preferredTargetFirmwareReleaseId,
              preferredTargetVersion: target.preferredTargetVersion,
              targetFirmwareReleaseId: target.targetFirmwareReleaseId!,
              targetVersion: target.targetVersion!,
              targetLogicalVersion: target.targetLogicalVersion!,
              targetPlatform: target.targetPlatform!,
              targetVariant: target.targetVariant,
              targetImageCode: target.targetImageCode,
              compatibilityStatus: target.compatibilityStatus,
              exceptionOverride: target.exceptionOverride,
              ...(target.exceptionSnapshot
                ? {
                    exceptionSnapshot:
                      target.exceptionSnapshot as Prisma.InputJsonValue,
                  }
                : {}),
              ...(target.memberSnapshot
                ? {
                    memberSnapshot:
                      target.memberSnapshot as Prisma.InputJsonValue,
                  }
                : {}),
              upgradeCapability: target.upgradeCapability,
            })),
          },
          events: {
            create: {
              fromState: null,
              toState: 'PROPOSED',
              actorUserId,
              reason: preview.input.reason,
              notes: preview.input.notes,
              metadata: {
                source: 'PLAN_PREVIEW',
                requestedCount: preview.counts.requested,
                includedCount: preview.counts.included,
                exceptionOverrideCount: preview.counts.exceptionOverrides,
                proposedFor: preview.input.proposedFor?.toISOString() ?? null,
                proposedMaintenanceWindowReference:
                  preview.input.proposedMaintenanceWindowReference,
              },
            },
          },
        },
        include: {
          targets: { orderBy: { deviceName: 'asc' } },
          events: { orderBy: { createdAt: 'asc' } },
        },
      })

      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'FIRMWARE_WORK_PLAN_CREATED',
          entityType: 'FirmwareWorkPlan',
          entityId: plan.id,
          after: {
            state: plan.state,
            targetCount: plan.targets.length,
            title: plan.title,
            proposedFor: plan.proposedFor?.toISOString() ?? null,
            proposedMaintenanceWindowReference:
              plan.proposedMaintenanceWindowReference,
          },
          metadata: {
            requestedCount: preview.counts.requested,
            includedCount: preview.counts.included,
            exceptionOverrideCount: preview.counts.exceptionOverrides,
          },
        },
      })

      return plan
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  )
}
