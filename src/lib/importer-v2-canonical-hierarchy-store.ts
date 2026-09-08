import { prisma } from '@/lib/prisma'
import {
  resolveCanonicalHierarchy,
  type CanonicalHierarchyInput,
  type HierarchyIdentity,
} from '@/lib/importer-v2-canonical-hierarchy'
const select = {
  id: true,
  name: true,
  source: true,
  isActive: true,
  externalProvider: true,
  externalId: true,
} as const
export async function previewCanonicalHierarchy(
  input: CanonicalHierarchyInput,
) {
  // Only load candidates for the resolved customer; raw inventory is not scanned.
  const customers = await prisma.customer.findMany({
    where: input.customer?.id
      ? { id: input.customer.id }
      : input.customer?.externalProvider && input.customer.externalId
        ? {
            externalProvider: input.customer.externalProvider,
            externalId: input.customer.externalId,
          }
        : {
            name: { equals: input.customer?.label ?? '', mode: 'insensitive' },
          },
    select,
  })
  const customerIds = customers.map((customer) => customer.id)
  const [organizationUnits, sites] = await Promise.all([
    prisma.customerOrganizationUnit.findMany({
      where: { customerId: { in: customerIds } },
      select: { ...select, customerId: true, parentId: true },
    }),
    prisma.site.findMany({
      where: { customerId: { in: customerIds } },
      select: { ...select, customerId: true, organizationUnitId: true },
    }),
  ])
  return resolveCanonicalHierarchy(input, {
    customers,
    organizationUnits,
    sites,
  })
}
export function hierarchyInputFromEvaluated(
  evaluated: unknown,
): CanonicalHierarchyInput {
  const snapshot = evaluated as {
    proposedCanonicalValues?: Record<string, HierarchyIdentity | null>
    rawValues?: Record<string, string | null>
  }
  const target = (field: string) => {
    if (
      snapshot.proposedCanonicalValues &&
      field in snapshot.proposedCanonicalValues
    )
      return snapshot.proposedCanonicalValues[field] ?? null
    const label = snapshot.rawValues?.[field]
    return label ? { id: null, label } : null
  }
  return {
    customer: target('customer'),
    businessUnit: target('businessUnit'),
    site: target('site'),
  }
}
