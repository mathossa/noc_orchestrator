import { prisma } from '@/lib/prisma'

export class FirmwareWorkPlanCandidateError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'FirmwareWorkPlanCandidateError'
  }
}

export type FirmwareWorkPlanCandidateScope = {
  siteIds: string[]
  deviceTypeIds: string[]
}

function ids(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0)
    throw new FirmwareWorkPlanCandidateError(
      `${field} must contain at least one identifier.`,
    )

  const result = [
    ...new Set(
      value.map((item) => {
        if (typeof item !== 'string' || !item.trim())
          throw new FirmwareWorkPlanCandidateError(
            `${field} must contain non-empty string identifiers.`,
          )
        return item.trim()
      }),
    ),
  ].sort()

  if (result.length > 500)
    throw new FirmwareWorkPlanCandidateError(
      `${field} may contain at most 500 identifiers.`,
    )
  return result
}

export function parseFirmwareWorkPlanCandidateScope(
  raw: unknown,
): FirmwareWorkPlanCandidateScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new FirmwareWorkPlanCandidateError(
      'Planning candidate scope must be an object.',
    )
  const body = raw as Record<string, unknown>
  return {
    siteIds: ids(body.siteIds, 'siteIds'),
    deviceTypeIds: ids(body.deviceTypeIds, 'deviceTypeIds'),
  }
}

/**
 * Resolves site/type selection only. This deliberately does not evaluate
 * firmware policy, compatibility, exceptions or existing-plan eligibility;
 * the established #60 preview remains authoritative for those decisions.
 */
export async function listFirmwareWorkPlanCandidates(raw: unknown) {
  const scope = parseFirmwareWorkPlanCandidateScope(raw)
  return prisma.device.findMany({
    where: {
      isActive: true,
      siteId: { in: scope.siteIds },
      deviceModel: {
        deviceTypeId: { in: scope.deviceTypeIds },
      },
    },
    select: {
      id: true,
      name: true,
      customerId: true,
      deviceModelId: true,
      currentFirmwareNormalizedVersion: true,
      currentFirmwareRawVersion: true,
      customer: {
        select: {
          id: true,
          name: true,
        },
      },
      site: {
        select: {
          id: true,
          name: true,
        },
      },
      deviceModel: {
        select: {
          id: true,
          model: true,
          vendor: {
            select: {
              id: true,
              name: true,
            },
          },
          deviceType: {
            select: {
              id: true,
              code: true,
              name: true,
              isActive: true,
            },
          },
        },
      },
      currentFirmwareRelease: {
        select: {
          id: true,
          version: true,
        },
      },
    },
    orderBy: [
      { customerId: 'asc' },
      { siteId: 'asc' },
      { deviceModelId: 'asc' },
      { name: 'asc' },
    ],
  })
}
