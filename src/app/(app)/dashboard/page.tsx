import { OperationalOverview, type DashboardScope } from '@/components/dashboard/operational-overview'
import { buildCandidateWorkPackages, type WorkPackageKind } from '@/lib/dashboard-work-packages'
import { parseInventoryQuery, searchParamsToUrlSearchParams } from '@/lib/inventory-explorer'
import { getDashboardWorkPackageFindings, getInventoryFilterOptions } from '@/lib/inventory-explorer-store'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const validKinds = new Set<WorkPackageKind>(['URGENT', 'TO_PLAN', 'BLOCKED', 'CHECK'])

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = searchParamsToUrlSearchParams(await searchParams)
  const query = parseInventoryQuery(params)
  const requestedKind = params.get('kind') ?? ''
  const kind = validKinds.has(requestedKind as WorkPackageKind)
    ? requestedKind as WorkPackageKind
    : ''

  const scope: DashboardScope = {
    q: query.q,
    customer: query.customer,
    vendor: query.vendor,
    contract: query.contract,
    kind,
    page: query.page,
  }

  const [findings, filters] = await Promise.all([
    getDashboardWorkPackageFindings(query),
    getInventoryFilterOptions(),
  ])
  const packages = buildCandidateWorkPackages(findings)

  return <OperationalOverview scope={scope} filters={filters} packages={packages} />
}
