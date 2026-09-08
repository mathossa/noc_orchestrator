import { normalizedSiteName } from '@/lib/sites'

export type HierarchyIdentity = {
  id?: string | null
  label: string
  externalProvider?: string | null
  externalId?: string | null
}
export type HierarchyEntity = {
  id: string
  name: string
  source: string
  isActive: boolean
  externalProvider?: string | null
  externalId?: string | null
}
export type HierarchyCatalog = {
  customers: HierarchyEntity[]
  organizationUnits: Array<
    HierarchyEntity & { customerId: string; parentId: string | null }
  >
  sites: Array<
    HierarchyEntity & { customerId: string; organizationUnitId: string | null }
  >
}
export type CanonicalHierarchyInput = {
  customer: HierarchyIdentity | null
  businessUnit: HierarchyIdentity | null
  site: HierarchyIdentity | null
}
export type HierarchyResolution = {
  status: 'LINK' | 'UNRESOLVED' | 'INVALID' | 'ABSENT'
  id: string | null
  label: string | null
  reason: string
  preserveCanonicalValues: boolean
}
function resolve(
  target: HierarchyIdentity | null,
  candidates: HierarchyEntity[],
  optional = false,
): HierarchyResolution {
  const result = (
    status: HierarchyResolution['status'],
    reason: string,
    entity?: HierarchyEntity,
  ): HierarchyResolution => ({
    status,
    reason,
    id: entity?.id ?? null,
    label: entity?.name ?? target?.label ?? null,
    preserveCanonicalValues: true,
  })
  if (!target)
    return result(
      optional ? 'ABSENT' : 'UNRESOLVED',
      optional
        ? 'No unit supplied; site remains ungrouped.'
        : 'An explicit hierarchy selection is required.',
    )
  let matches: HierarchyEntity[]
  if (target.id)
    matches = candidates.filter((entity) => entity.id === target.id)
  else if (target.externalProvider && target.externalId)
    matches = candidates.filter(
      (entity) =>
        entity.externalProvider === target.externalProvider &&
        entity.externalId === target.externalId,
    )
  else
    matches = candidates.filter(
      (entity) =>
        normalizedSiteName(entity.name) === normalizedSiteName(target.label),
    )
  if (matches.length !== 1)
    return result(
      target.id ? 'INVALID' : 'UNRESOLVED',
      target.id
        ? 'Selected record is outside this customer/unit context or does not exist.'
        : matches.length
          ? 'Multiple candidates; explicitly link the correct record.'
          : 'Unknown record; explicitly link or create it in this customer/unit context.',
    )
  if (!matches[0].isActive)
    return result(
      'UNRESOLVED',
      'Selected record is inactive; review before linking.',
    )
  return result(
    'LINK',
    matches[0].source === 'MANUAL'
      ? 'Link existing record and preserve manually owned canonical values.'
      : 'Link existing record; preserve canonical values and source evidence.',
    matches[0],
  )
}
/** Read-only resolution contract for #51. IDs are validated in context, never
 * replaced with weaker name matches. Linked values are never source-overwritten.
 */
export function resolveCanonicalHierarchy(
  input: CanonicalHierarchyInput,
  catalog: HierarchyCatalog,
) {
  const customer = resolve(input.customer, catalog.customers)
  const organizationUnit = resolve(
    input.businessUnit,
    catalog.organizationUnits.filter(
      (unit) =>
        unit.customerId === customer.id &&
        (input.businessUnit?.id ||
          (input.businessUnit?.externalProvider &&
            input.businessUnit.externalId) ||
          unit.parentId === null),
    ),
    true,
  )
  const site = resolve(
    input.site,
    customer.status === 'LINK' &&
      ['LINK', 'ABSENT'].includes(organizationUnit.status)
      ? catalog.sites.filter(
          (site) =>
            site.customerId === customer.id &&
            site.organizationUnitId === organizationUnit.id,
        )
      : [],
  )
  return {
    customer,
    organizationUnit,
    site,
    ready:
      customer.status === 'LINK' &&
      ['LINK', 'ABSENT'].includes(organizationUnit.status) &&
      site.status === 'LINK',
    sourceEvidence: input,
  }
}
