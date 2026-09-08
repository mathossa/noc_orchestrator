import { parseSiteInput, SiteValidationError } from '@/lib/sites'

export type OrganizationUnitReference = {
  id: string
  customerId: string
  parentId: string | null
  name: string
  isActive: boolean
}
export type OrganizationUnitRecord = OrganizationUnitReference & {
  code: string | null
  notes: string | null
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  sourceMetadata: unknown
  createdAt: string
  updatedAt: string
  siteCount: number
  deviceCount: number
}
export function parseOrganizationUnitInput(raw: unknown) {
  const body =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const { name, code, notes, source, externalProvider, externalId, isActive } =
    parseSiteInput(body)
  const parentId =
    typeof body.parentId === 'string' ? body.parentId.trim() || null : null
  if (body.parentId != null && typeof body.parentId !== 'string')
    throw new SiteValidationError('Invalid parent.', {
      parentId: 'Choose a parent unit or Ungrouped.',
    })
  const lastSynchronizedAt = body.lastSynchronizedAt
    ? new Date(String(body.lastSynchronizedAt))
    : null
  if (lastSynchronizedAt && Number.isNaN(lastSynchronizedAt.getTime()))
    throw new SiteValidationError('Invalid synchronization date.', {
      lastSynchronizedAt: 'Enter a valid date.',
    })
  if (
    body.sourceMetadata != null &&
    (typeof body.sourceMetadata !== 'object' ||
      Array.isArray(body.sourceMetadata))
  )
    throw new SiteValidationError('Invalid source metadata.', {
      sourceMetadata: 'Expected a JSON object.',
    })
  const sourceMetadata =
    body.sourceMetadata == null
      ? null
      : (JSON.parse(JSON.stringify(body.sourceMetadata)) as Record<
          string,
          import('../generated/prisma/client').Prisma.InputJsonValue
        >)
  return {
    name,
    code,
    notes,
    source,
    externalProvider,
    externalId,
    isActive,
    parentId,
    lastSynchronizedAt,
    sourceMetadata,
  }
}

// "none" means a site with no unit. Site-less devices are a separate bucket.
export function organizationUnitSiteWhere(value?: string) {
  return value ? { organizationUnitId: value === 'none' ? null : value } : {}
}
export function organizationUnitDeviceWhere(value?: string) {
  return value ? { site: { is: organizationUnitSiteWhere(value) } } : {}
}
