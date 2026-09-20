// SPDX-License-Identifier: AGPL-3.0-only
import type { FirmwareWorkPlanTarget, Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveFirmwareWorkPlanLiveTargets } from '@/lib/firmware-work-plan-live'
import {
  FIRMWARE_WORK_PLAN_STATES,
  isActiveFirmwareWorkPlanState,
  type FirmwareWorkPlanState,
  type FirmwareWorkPlanStaleReason,
} from '@/lib/firmware-work-planning'

type Db = Prisma.TransactionClient
type PlanWithTargets = Prisma.FirmwareWorkPlanGetPayload<{
  include: { targets: true }
}>

function planState(value: string): FirmwareWorkPlanState {
  const state = FIRMWARE_WORK_PLAN_STATES.find((state) => state === value)
  if (!state) throw new Error(`Unknown firmware work plan state: ${value}`)
  return state
}

function snapshotSummary(targets: FirmwareWorkPlanTarget[]) {
  const customers = new Map<
    string,
    { id: string; name: string; targetCount: number }
  >()
  const sites = new Map<
    string,
    {
      id: string | null
      name: string | null
      customerId: string
      targetCount: number
    }
  >()
  const distribution = new Map<
    string,
    {
      firmwareReleaseId: string
      version: string
      logicalVersion: string
      platform: string
      variant: string | null
      imageCode: string | null
      count: number
    }
  >()
  for (const target of targets) {
    const customer = customers.get(target.customerId)
    if (customer) customer.targetCount++
    else
      customers.set(target.customerId, {
        id: target.customerId,
        name: target.customerName,
        targetCount: 1,
      })
    const siteKey = JSON.stringify([target.customerId, target.siteId])
    const site = sites.get(siteKey)
    if (site) site.targetCount++
    else
      sites.set(siteKey, {
        id: target.siteId,
        name: target.siteName,
        customerId: target.customerId,
        targetCount: 1,
      })
    // Include all immutable image identity fields, even if catalog labels changed
    // between target snapshots sharing the same release ID.
    const image = {
      firmwareReleaseId: target.targetFirmwareReleaseId,
      version: target.targetVersion,
      logicalVersion: target.targetLogicalVersion,
      platform: target.targetPlatform,
      variant: target.targetVariant,
      imageCode: target.targetImageCode,
    }
    const key = JSON.stringify(image)
    const existing = distribution.get(key)
    if (existing) existing.count++
    else distribution.set(key, { ...image, count: 1 })
  }
  return {
    customers: [...customers.values()],
    sites: [...sites.values()],
    targetDistribution: [...distribution.values()],
    exceptionOverrides: targets
      .filter((t) => t.exceptionOverride)
      .map((t) => ({
        targetId: t.id,
        deviceId: t.deviceId,
        exceptionSnapshot: t.exceptionSnapshot,
      })),
  }
}

async function projectPlans(plans: PlanWithTargets[], at: Date, db: Db) {
  const live = await resolveFirmwareWorkPlanLiveTargets(
    plans.flatMap((plan) =>
      plan.targets.map((snapshot) => ({
        state: planState(plan.state),
        snapshot,
      })),
    ),
    at,
    db,
  )
  return plans.map((plan) => {
    const state = planState(plan.state)
    const targets = plan.targets.map((snapshot) => ({
      snapshot,
      ...live.get(snapshot.id)!,
    }))
    const staleReasonCounts: Partial<
      Record<FirmwareWorkPlanStaleReason, number>
    > = {}
    for (const target of targets)
      for (const reason of target.staleness.reasons)
        staleReasonCounts[reason] = (staleReasonCounts[reason] ?? 0) + 1
    return {
      ...plan,
      state,
      active: isActiveFirmwareWorkPlanState(state),
      targets,
      targetCount: targets.length,
      stale: targets.some((t) => t.staleness.stale),
      staleReasonCounts,
      ...snapshotSummary(plan.targets),
    }
  })
}

export type FirmwareWorkPlanReadModel = Awaited<
  ReturnType<typeof projectPlans>
>[number]
export type FirmwareWorkPlanQuery = {
  states?: FirmwareWorkPlanState[]
  customerId?: string
  siteId?: string
  deviceId?: string
  vendorId?: string
  deviceModelFamilyId?: string
  deviceModelId?: string
  recommendation?: string
  scheduledFrom?: Date
  scheduledUntil?: Date
  page?: number
  pageSize?: number
}

/** Customer/site/model/recommendation filters refer to saved planning context.
 * Vendor/family are resolved through the current model taxonomy to the snapshotted
 * deviceModelId. A matching target selects the entire plan, not a partial target count.
 */
export async function listFirmwareWorkPlans(query: FirmwareWorkPlanQuery = {}) {
  const page = Number.isSafeInteger(query.page) ? Math.max(1, query.page!) : 1
  const pageSize = Number.isSafeInteger(query.pageSize)
    ? Math.min(200, Math.max(1, query.pageSize!))
    : 50
  const savedTargetWhere: Prisma.FirmwareWorkPlanTargetWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.deviceId ? { deviceId: query.deviceId } : {}),
    ...(query.recommendation ? { recommendation: query.recommendation } : {}),
  }
  return prisma.$transaction(
    async (db) => {
      const at = new Date()
      let deviceModelId: Prisma.FirmwareWorkPlanTargetWhereInput['deviceModelId'] =
        query.deviceModelId
      if (query.vendorId || query.deviceModelFamilyId) {
        const models = await db.deviceModel.findMany({
          where: {
            ...(query.deviceModelId ? { id: query.deviceModelId } : {}),
            ...(query.vendorId ? { vendorId: query.vendorId } : {}),
            ...(query.deviceModelFamilyId
              ? { familyId: query.deviceModelFamilyId }
              : {}),
          },
          select: { id: true },
        })
        deviceModelId = { in: models.map((model) => model.id) }
      }
      const targetWhere: Prisma.FirmwareWorkPlanTargetWhereInput = {
        ...savedTargetWhere,
        ...(deviceModelId ? { deviceModelId } : {}),
      }
      const where: Prisma.FirmwareWorkPlanWhereInput = {
        ...(query.states ? { state: { in: query.states.map(planState) } } : {}),
        ...(Object.keys(targetWhere).length
          ? { targets: { some: targetWhere } }
          : {}),
        ...(query.scheduledFrom || query.scheduledUntil
          ? {
              scheduledFor: {
                ...(query.scheduledFrom ? { gte: query.scheduledFrom } : {}),
                ...(query.scheduledUntil ? { lt: query.scheduledUntil } : {}),
              },
            }
          : {}),
      }
      const [plans, total] = await Promise.all([
        db.firmwareWorkPlan.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          include: {
            targets: { orderBy: [{ deviceName: 'asc' }, { id: 'asc' }] },
          },
        }),
        db.firmwareWorkPlan.count({ where }),
      ])
      return {
        data: await projectPlans(plans, at, db),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      }
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  )
}

export async function getFirmwareWorkPlan(id: string) {
  return prisma.$transaction(
    async (db) => {
      const at = new Date()
      const plan = await db.firmwareWorkPlan.findUnique({
        where: { id },
        include: {
          targets: { orderBy: [{ deviceName: 'asc' }, { id: 'asc' }] },
          events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      })
      if (!plan) return null
      const [projected] = await projectPlans([plan], at, db)
      return { ...projected, events: plan.events }
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  )
}

/** Append-oriented transition/target evidence, returned verbatim in stable order. */
export async function listFirmwareWorkPlanHistory(
  planId: string,
  db: Db = prisma,
) {
  return db.firmwareWorkPlanEvent.findMany({
    where: { planId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

/** Overview projection: terminal history cannot overwrite current active work.
 * Keep arrays so corrupt/legacy overlapping active plans are visible, not hidden.
 */
export async function resolveDeviceWorkPlanning(
  deviceIds: string[],
  db: Db = prisma,
) {
  const ids = [...new Set(deviceIds)]
  const records = ids.length
    ? await db.firmwareWorkPlanTarget.findMany({
        where: { deviceId: { in: ids } },
        select: {
          id: true,
          deviceId: true,
          plan: {
            select: {
              id: true,
              state: true,
              proposedFor: true,
              proposedMaintenanceWindowReference: true,
              scheduledFor: true,
              maintenanceWindowReference: true,
              completedAt: true,
              cancelledAt: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })
    : []
  type PlanReference = (typeof records)[number]['plan'] & {
    targetId: string
    state: FirmwareWorkPlanState
  }
  type Projection = {
    deviceId: string
    planned: boolean
    state: FirmwareWorkPlanState | 'NOT_PLANNED'
    activePlans: PlanReference[]
    history: PlanReference[]
  }
  const result = new Map<string, Projection>(
    ids.map((deviceId) => [
      deviceId,
      {
        deviceId,
        planned: false,
        state: 'NOT_PLANNED',
        activePlans: [],
        history: [],
      },
    ]),
  )
  for (const row of records) {
    const projection = result.get(row.deviceId)!
    const state = planState(row.plan.state)
    const reference = { ...row.plan, state, targetId: row.id }
    if (isActiveFirmwareWorkPlanState(state)) {
      projection.activePlans.push(reference)
      projection.planned = true
      projection.state = projection.activePlans[0].state
    } else projection.history.push(reference)
  }
  return result
}
