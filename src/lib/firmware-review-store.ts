// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  firmwareComplianceLabel,
  type FirmwareComplianceResult,
} from '@/lib/firmware-compliance'
import { resolveFirmwareComplianceBatch } from '@/lib/firmware-compliance-store'
import {
  resolveFirmwareExceptions,
  type ExceptionRecord,
} from '@/lib/firmware-exceptions'
import {
  firmwareReviewDueState,
  firmwareReviewSnapshotFromJson,
  firmwareReviewSnapshotHash,
  firmwareReviewWorkspaceMetrics,
  parseFirmwareReviewCycleInput,
  summarizeFirmwareReviewRows,
  type FirmwareReviewSnapshotRow,
} from '@/lib/firmware-review'

type Db = Prisma.TransactionClient

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
  hostname: true,
  customerId: true,
  siteId: true,
  deviceModelId: true,
  currentFirmwareReleaseId: true,
  currentFirmwareRawVersion: true,
  currentFirmwareNormalizedVersion: true,
  currentFirmwareObservedAt: true,
  source: true,
  externalProvider: true,
  customer: { select: { id: true, name: true } },
  site: {
    select: {
      id: true,
      name: true,
      organizationUnit: { select: { id: true, name: true } },
    },
  },
  deviceModel: {
    select: {
      id: true,
      model: true,
      platform: true,
      preferredPlatform: true,
      familyId: true,
      family: { select: { id: true, name: true } },
      vendor: { select: { id: true, code: true, name: true } },
      deviceType: { select: { id: true, code: true, name: true } },
    },
  },
} as const

type SelectedDevice = Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>

export class FirmwareReviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'FirmwareReviewError'
  }
}

function exceptionRowsForDevice(
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
        return (
          !!device.deviceModel.familyId &&
          row.scopeId === device.deviceModel.familyId
        )
      default:
        return false
    }
  })
}

function technicalSnapshot(result: FirmwareComplianceResult) {
  const policy = result.effectivePolicy.policy
  const source = result.policySource
  return {
    compliance: result.compliance,
    relationToPreferred: result.relationToPreferred,
    recommendation: result.recommendation,
    label: firmwareComplianceLabel(result),
    explanation: result.explanation,
    effectiveTrack: result.effectiveTrack,
    policy: policy
      ? {
          id: policy.id,
          mode: policy.policyMode,
          version: policy.policyVersion,
          trackKey: policy.trackKey,
          trackName: policy.trackName,
          trackClass: policy.trackClass,
          desiredPlatform: policy.desiredPlatform,
          minimumFirmwareReleaseId: policy.minimumFirmwareReleaseId,
          targetFirmwareReleaseId: policy.targetFirmwareReleaseId,
          maximumFirmwareReleaseId: policy.maximumFirmwareReleaseId,
          firmwareTrainId: policy.firmwareTrainId,
        }
      : null,
    policySource: source
      ? {
          scope: source.scope,
          scopeId: source.scopeId,
          subject: source.subject,
          subjectId: source.subjectId,
          policyId: source.policyId,
          trackKey: source.trackKey,
          trackName: source.trackName,
          trackClass: source.trackClass,
          policyVersion: source.policyVersion,
          effectiveFrom: source.effectiveFrom,
        }
      : null,
    preferredTarget: result.preferredTarget
      ? {
          id: result.preferredTarget.id,
          platform: result.preferredTarget.platform,
          version: result.preferredTarget.version,
          logicalVersion: result.preferredTarget.logicalVersion,
          trainId: result.preferredTarget.firmwareTrainId,
          trainName: result.preferredTarget.firmwareTrain?.name ?? null,
        }
      : null,
    resolvedTarget: result.resolvedTarget
      ? {
          id: result.resolvedTarget.id,
          platform: result.resolvedTarget.platform,
          version: result.resolvedTarget.version,
          logicalVersion: result.resolvedTarget.logicalVersion,
          variant: result.resolvedTarget.variant,
          imageCode: result.resolvedTarget.imageCode,
        }
      : null,
  }
}

function reviewSummaryRow(
  row: {
    deviceId: string
    deviceName: string
    siteId: string | null
    siteName: string | null
    technical: { compliance: string; recommendation: string }
    exception: { reasonCode: string; replacementRelated: boolean } | null
    planning: { state: string } | null
    attentionClass: FirmwareReviewSnapshotRow['attentionClass']
  },
): FirmwareReviewSnapshotRow {
  return {
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    siteId: row.siteId,
    siteName: row.siteName,
    compliance: row.technical.compliance,
    recommendation: row.technical.recommendation,
    exceptionReasonCode: row.exception?.reasonCode ?? null,
    planningState: row.planning?.state ?? null,
    attentionClass: row.attentionClass,
  }
}

async function buildSnapshot(
  db: Db,
  cycle: {
    id: string
    customerId: string
    customerName: string
    periodStart: Date
    periodEnd: Date
  },
  version: number,
  at: Date,
) {
  const devices = await db.device.findMany({
    where: { customerId: cycle.customerId, isActive: true },
    select: deviceSelect,
    orderBy: [{ siteId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  })
  const deviceIds = devices.map((device) => device.id)
  const siteIds = [
    ...new Set(
      devices.flatMap((device) => (device.siteId ? [device.siteId] : [])),
    ),
  ]
  const modelIds = [...new Set(devices.map((device) => device.deviceModelId))]
  const familyIds = [
    ...new Set(
      devices.flatMap((device) =>
        device.deviceModel.familyId ? [device.deviceModel.familyId] : [],
      ),
    ),
  ]

  const exceptionScopes: Prisma.FirmwareExceptionWhereInput[] = [
    { scope: 'DEVICE', scopeId: { in: deviceIds } },
    { scope: 'CUSTOMER', scopeId: cycle.customerId },
    { scope: 'MODEL', scopeId: { in: modelIds } },
  ]
  if (siteIds.length)
    exceptionScopes.push({ scope: 'SITE', scopeId: { in: siteIds } })
  if (familyIds.length)
    exceptionScopes.push({ scope: 'FAMILY', scopeId: { in: familyIds } })

  const [technicalByDevice, exceptionRows, exceptionReasons, planTargets] =
    await Promise.all([
      resolveFirmwareComplianceBatch(deviceIds, at, db),
      deviceIds.length
        ? db.firmwareException.findMany({
            where: { OR: exceptionScopes },
            orderBy: [{ decidedAt: 'desc' }, { id: 'asc' }],
          })
        : [],
      db.firmwareExceptionReason.findMany({
        select: { code: true, replacementRelated: true },
      }),
      deviceIds.length
        ? db.firmwareWorkPlanTarget.findMany({
            where: {
              deviceId: { in: deviceIds },
              plan: { state: { in: [...ACTIVE_PLAN_STATES] } },
            },
            select: {
              deviceId: true,
              plan: {
                select: {
                  id: true,
                  title: true,
                  state: true,
                  proposedFor: true,
                  proposedMaintenanceWindowReference: true,
                  scheduledFor: true,
                  maintenanceWindowReference: true,
                  externalReference: true,
                  createdAt: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
    ])

  const reasonReplacement = new Map(
    exceptionReasons.map((reason) => [reason.code, reason.replacementRelated]),
  )
  const planByDevice = new Map<string, (typeof planTargets)[number]['plan']>()
  for (const target of planTargets)
    if (!planByDevice.has(target.deviceId))
      planByDevice.set(target.deviceId, target.plan)

  const rows = devices.map((device) => {
    const technical = technicalByDevice.get(device.id)
    if (!technical)
      throw new FirmwareReviewError(
        `Firmware compliance could not be resolved for ${device.name}.`,
        409,
      )

    const exception = resolveFirmwareExceptions(
      exceptionRowsForDevice(exceptionRows as ExceptionRecord[], device),
      {
        id: device.id,
        customerId: device.customerId,
        siteId: device.siteId,
        deviceModelId: device.deviceModelId,
        deviceModel: { familyId: device.deviceModel.familyId },
      },
      technical,
      at,
    ).selected

    const plan = planByDevice.get(device.id) ?? null
    const replacementRelated = exception
      ? reasonReplacement.get(exception.reasonCode) === true
      : false
    const attentionClass: FirmwareReviewSnapshotRow['attentionClass'] =
      replacementRelated ? 'REPLACEMENT_OR_EOL' : 'FIRMWARE'

    return {
      deviceId: device.id,
      deviceName: device.name,
      hostname: device.hostname,
      siteId: device.site?.id ?? null,
      siteName: device.site?.name ?? null,
      organizationUnit: device.site?.organizationUnit
        ? {
            id: device.site.organizationUnit.id,
            name: device.site.organizationUnit.name,
          }
        : null,
      vendor: {
        id: device.deviceModel.vendor.id,
        code: device.deviceModel.vendor.code,
        name: device.deviceModel.vendor.name,
      },
      deviceType: {
        id: device.deviceModel.deviceType.id,
        code: device.deviceModel.deviceType.code,
        name: device.deviceModel.deviceType.name,
      },
      model: {
        id: device.deviceModel.id,
        name: device.deviceModel.model,
        familyId: device.deviceModel.family?.id ?? null,
        familyName: device.deviceModel.family?.name ?? null,
        platform: device.deviceModel.platform,
        preferredPlatform: device.deviceModel.preferredPlatform,
      },
      inventorySource: {
        source: device.source,
        externalProvider: device.externalProvider,
      },
      currentFirmware: {
        releaseId: technical.currentFirmware?.id ?? device.currentFirmwareReleaseId,
        platform: technical.currentFirmware?.platform ?? null,
        version:
          technical.currentFirmware?.version ??
          device.currentFirmwareNormalizedVersion ??
          device.currentFirmwareRawVersion,
        rawVersion: device.currentFirmwareRawVersion,
        observedAt: device.currentFirmwareObservedAt?.toISOString() ?? null,
        catalogState: technical.currentFirmware?.catalogState ?? null,
        policyEligibility: technical.currentFirmware?.policyEligibility ?? null,
      },
      technical: technicalSnapshot(technical),
      exception: exception
        ? {
            id: exception.id,
            reasonCode: exception.reasonCode,
            scope: exception.scope,
            scopeId: exception.scopeId,
            scopeLabel: exception.scopeLabel,
            subject: exception.subject,
            duration: exception.duration,
            decidedAt: new Date(exception.decidedAt).toISOString(),
            expiresAt: exception.expiresAt
              ? new Date(exception.expiresAt).toISOString()
              : null,
            contactReference: exception.contactReference,
            ticketReference: exception.ticketReference,
            replacementRelated,
          }
        : null,
      planning: plan
        ? {
            id: plan.id,
            title: plan.title,
            state: plan.state,
            proposedFor: plan.proposedFor?.toISOString() ?? null,
            proposedMaintenanceWindowReference:
              plan.proposedMaintenanceWindowReference,
            scheduledFor: plan.scheduledFor?.toISOString() ?? null,
            maintenanceWindowReference: plan.maintenanceWindowReference,
            externalReference: plan.externalReference,
          }
        : null,
      attentionClass,
    }
  })

  const summaryRows = rows.map(reviewSummaryRow)
  const siteGroups = new Map<
    string,
    {
      siteId: string | null
      siteName: string | null
      organizationUnit: { id: string; name: string } | null
      rows: typeof rows
    }
  >()

  for (const row of rows) {
    const key = row.siteId ?? '__NO_SITE__'
    const group = siteGroups.get(key)
    if (group) group.rows.push(row)
    else
      siteGroups.set(key, {
        siteId: row.siteId,
        siteName: row.siteName,
        organizationUnit: row.organizationUnit,
        rows: [row],
      })
  }

  return {
    schemaVersion: 2,
    reviewCycleId: cycle.id,
    reportVersion: version,
    generatedAt: at.toISOString(),
    reviewPeriod: {
      start: cycle.periodStart.toISOString(),
      end: cycle.periodEnd.toISOString(),
    },
    customer: {
      id: cycle.customerId,
      name: cycle.customerName,
    },
    summary: summarizeFirmwareReviewRows(summaryRows),
    sites: [...siteGroups.values()]
      .map((site) => ({
        siteId: site.siteId,
        siteName: site.siteName,
        organizationUnit: site.organizationUnit,
        summary: summarizeFirmwareReviewRows(site.rows.map(reviewSummaryRow)),
        devices: site.rows,
      }))
      .sort(
        (left, right) =>
          (left.siteName ?? '').localeCompare(right.siteName ?? '') ||
          (left.siteId ?? '').localeCompare(right.siteId ?? ''),
      ),
  }
}

export async function createFirmwareReviewCycle(
  raw: unknown,
  reviewerUserId: string | null = null,
) {
  const at = new Date()
  const input = parseFirmwareReviewCycleInput(raw, at)

  return prisma.$transaction(async (db) => {
    const customer = await db.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, name: true },
    })
    if (!customer) throw new FirmwareReviewError('Customer was not found.', 404)

    const cycle = await db.firmwareReviewCycle.create({
      data: {
        customerId: customer.id,
        customerName: customer.name,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        asOf: at,
        nextReviewAt: input.nextReviewAt,
        reviewerUserId,
        reviewerName: input.reviewerName,
      },
    })

    await db.auditEvent.create({
      data: {
        actorUserId: reviewerUserId,
        customerId: customer.id,
        action: 'FIRMWARE_REVIEW_CYCLE_CREATED',
        entityType: 'FirmwareReviewCycle',
        entityId: cycle.id,
        after: {
          periodStart: cycle.periodStart.toISOString(),
          periodEnd: cycle.periodEnd.toISOString(),
          nextReviewAt: cycle.nextReviewAt?.toISOString() ?? null,
          state: cycle.state,
        },
      },
    })

    return cycle
  })
}

export async function generateFirmwareReviewReport(
  reviewCycleId: string,
  generatedByUserId: string | null = null,
) {
  return prisma.$transaction(
    async (db) => {
      const cycle = await db.firmwareReviewCycle.findUnique({
        where: { id: reviewCycleId },
      })
      if (!cycle) throw new FirmwareReviewError('Review cycle was not found.', 404)
      if (cycle.state === 'CLOSED')
        throw new FirmwareReviewError(
          'Closed review cycles cannot generate a new report version.',
          409,
        )

      const latest = await db.firmwareReviewReport.aggregate({
        where: { reviewCycleId },
        _max: { version: true },
      })
      const version = (latest._max.version ?? 0) + 1
      const at = new Date()
      const snapshot = await buildSnapshot(db, cycle, version, at)
      const snapshotHash = firmwareReviewSnapshotHash(snapshot)

      const report = await db.firmwareReviewReport.create({
        data: {
          reviewCycleId,
          version,
          generatedByUserId,
          snapshot: snapshot as Prisma.InputJsonValue,
          snapshotHash,
        },
      })

      await db.firmwareReviewCycle.update({
        where: { id: reviewCycleId },
        data: { asOf: at },
      })
      await db.auditEvent.create({
        data: {
          actorUserId: generatedByUserId,
          customerId: cycle.customerId,
          action: 'FIRMWARE_REVIEW_REPORT_GENERATED',
          entityType: 'FirmwareReviewReport',
          entityId: report.id,
          after: {
            reviewCycleId,
            version,
            snapshotHash,
            generatedAt: report.generatedAt.toISOString(),
          },
        },
      })

      return { ...report, snapshot }
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  )
}

export async function getFirmwareReviewCycle(id: string) {
  return prisma.firmwareReviewCycle.findUnique({
    where: { id },
    include: {
      reports: { orderBy: [{ version: 'desc' }, { generatedAt: 'desc' }] },
    },
  })
}

export async function listFirmwareReviewCycles(input?: {
  customerId?: string
  state?: string
}) {
  return prisma.firmwareReviewCycle.findMany({
    where: {
      ...(input?.customerId ? { customerId: input.customerId } : {}),
      ...(input?.state ? { state: input.state } : {}),
    },
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    include: {
      reports: {
        orderBy: { version: 'desc' },
        take: 1,
        select: {
          id: true,
          version: true,
          status: true,
          generatedAt: true,
          snapshotHash: true,
        },
      },
    },
  })
}


export async function listFirmwareReviewWorkspace(at: Date = new Date()) {
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, code: true },
  })
  if (!customers.length) return []

  const cycles = await prisma.firmwareReviewCycle.findMany({
    where: { customerId: { in: customers.map((customer) => customer.id) } },
    orderBy: [
      { customerId: 'asc' },
      { periodEnd: 'desc' },
      { createdAt: 'desc' },
    ],
    include: {
      reports: {
        orderBy: [{ version: 'desc' }, { generatedAt: 'desc' }],
        take: 1,
      },
    },
  })

  const latestByCustomer = new Map<string, (typeof cycles)[number]>()
  for (const cycle of cycles)
    if (!latestByCustomer.has(cycle.customerId))
      latestByCustomer.set(cycle.customerId, cycle)

  return customers.map((customer) => {
    const cycle = latestByCustomer.get(customer.id) ?? null
    const report = cycle?.reports[0] ?? null
    const snapshot = report
      ? firmwareReviewSnapshotFromJson(report.snapshot)
      : null

    return {
      customer,
      dueState: firmwareReviewDueState(cycle, at),
      cycle: cycle
        ? {
            id: cycle.id,
            state: cycle.state,
            decisionStatus: cycle.decisionStatus,
            periodStart: cycle.periodStart,
            periodEnd: cycle.periodEnd,
            asOf: cycle.asOf,
            nextReviewAt: cycle.nextReviewAt,
            reviewerName: cycle.reviewerName,
          }
        : null,
      latestReport: report
        ? {
            id: report.id,
            version: report.version,
            status: report.status,
            generatedAt: report.generatedAt,
            snapshotHash: report.snapshotHash,
          }
        : null,
      metrics: snapshot ? firmwareReviewWorkspaceMetrics(snapshot, at) : null,
    }
  })
}
