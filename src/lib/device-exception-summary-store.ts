import { prisma } from '@/lib/prisma'
import type { FirmwareComplianceResult } from '@/lib/firmware-compliance'
import { resolveFirmwareExceptions } from '@/lib/firmware-exceptions'

export type DeviceExceptionSummaryState =
  | 'NONE'
  | 'ACTIVE'
  | 'REVIEW_DUE'
  | 'EXPIRED'

export type DeviceEffectiveException = {
  id: string
  reasonCode: string
  reasonLabel: string
  scope: string
  scopeLabel: string
  duration: string
  expiresAt: string | null
}

export type DeviceExceptionSummary = {
  state: DeviceExceptionSummaryState
  effective: DeviceEffectiveException | null
  activeCount: number
  inheritedCount: number
  historyCount: number
  reviewDueAt: string | null
}

type SummaryDevice = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
}

const NONE: DeviceExceptionSummary = {
  state: 'NONE',
  effective: null,
  activeCount: 0,
  inheritedCount: 0,
  historyCount: 0,
  reviewDueAt: null,
}

function dateIso(value: Date | string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function listDeviceExceptionReasonReferences() {
  return prisma.firmwareExceptionReason.findMany({
    where: { isActive: true },
    select: { code: true, label: true },
    orderBy: { label: 'asc' },
  })
}

export async function resolveDeviceExceptionSummaries(
  devices: SummaryDevice[],
  technicalByDevice: Map<string, FirmwareComplianceResult>,
  at = new Date(),
): Promise<Map<string, DeviceExceptionSummary>> {
  if (devices.length === 0) return new Map()

  const modelIds = [...new Set(devices.map((device) => device.deviceModelId))]
  const [rows, reasons, models] = await Promise.all([
    prisma.firmwareException.findMany({ orderBy: { decidedAt: 'desc' } }),
    prisma.firmwareExceptionReason.findMany({
      select: { code: true, label: true },
    }),
    prisma.deviceModel.findMany({
      where: { id: { in: modelIds } },
      select: { id: true, familyId: true },
    }),
  ])

  const reasonLabels = new Map(reasons.map((reason) => [reason.code, reason.label]))
  const familyByModel = new Map(models.map((model) => [model.id, model.familyId]))
  const rowsByScope = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.scope}:${row.scopeId}`
    const scoped = rowsByScope.get(key)
    if (scoped) scoped.push(row)
    else rowsByScope.set(key, [row])
  }

  const reviewThreshold = new Date(at.getTime() + 30 * 86_400_000)
  const summaries = new Map<string, DeviceExceptionSummary>()

  for (const device of devices) {
    const technical = technicalByDevice.get(device.id)
    if (!technical) {
      summaries.set(device.id, NONE)
      continue
    }

    const familyId = familyByModel.get(device.deviceModelId) ?? null
    const candidateRows = [
      ...(rowsByScope.get(`DEVICE:${device.id}`) ?? []),
      ...(device.siteId ? rowsByScope.get(`SITE:${device.siteId}`) ?? [] : []),
      ...(rowsByScope.get(`CUSTOMER:${device.customerId}`) ?? []),
      ...(rowsByScope.get(`MODEL:${device.deviceModelId}`) ?? []),
      ...(familyId ? rowsByScope.get(`FAMILY:${familyId}`) ?? [] : []),
    ]

    const resolution = resolveFirmwareExceptions(
      candidateRows,
      {
        ...device,
        deviceModel: { familyId },
      },
      technical,
      at,
    )

    const selected = resolution.selected
    const selectedExpiry = selected ? dateIso(selected.expiresAt) : null
    const applicableExpiries = resolution.applicable
      .map((record) => dateIso(record.expiresAt))
      .filter((value): value is string => Boolean(value))
      .sort()
    const nearestApplicableExpiry = applicableExpiries[0] ?? null
    const reviewDueAt = selectedExpiry ?? nearestApplicableExpiry
    const reviewDueDate = reviewDueAt ? new Date(reviewDueAt) : null
    const policyChanged = resolution.records.some(
      (record) => record.status === 'POLICY_CHANGED' && record.subjectMatches,
    )
    const expired = resolution.records.some(
      (record) => record.status === 'EXPIRED' && record.subjectMatches,
    )
    const activeReviewDue = Boolean(
      reviewDueDate && reviewDueDate <= reviewThreshold,
    )

    const state: DeviceExceptionSummaryState = resolution.applicable.length > 0
      ? activeReviewDue
        ? 'REVIEW_DUE'
        : 'ACTIVE'
      : policyChanged
        ? 'REVIEW_DUE'
        : expired
          ? 'EXPIRED'
          : 'NONE'

    summaries.set(device.id, {
      state,
      effective: selected
        ? {
            id: selected.id,
            reasonCode: selected.reasonCode,
            reasonLabel:
              reasonLabels.get(selected.reasonCode) ?? selected.reasonCode,
            scope: selected.scope,
            scopeLabel: selected.scopeLabel,
            duration: selected.duration,
            expiresAt: selectedExpiry,
          }
        : null,
      activeCount: resolution.applicable.length,
      inheritedCount: selected
        ? Math.max(0, resolution.applicable.length - 1)
        : resolution.applicable.length,
      historyCount: resolution.records.length,
      reviewDueAt,
    })
  }

  return summaries
}
