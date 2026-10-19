import { FirmwareCampaignOverview, type CampaignFocus, type CampaignScope } from '@/components/dashboard/firmware-campaign-overview'
import { buildFirmwareCampaigns } from '@/lib/dashboard-firmware-campaigns'
import { parseInventoryQuery, searchParamsToUrlSearchParams } from '@/lib/inventory-explorer'
import { getDashboardWorkPackageFindings, getInventoryFilterOptions } from '@/lib/inventory-explorer-store'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const validFocus = new Set<CampaignFocus>(['critical', 'required', 'recommended', 'review'])

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = searchParamsToUrlSearchParams(await searchParams)
  // Use the same scoped source/filter logic as Inventory. Search lives in Inventory, not here.
  params.delete('q')
  const query = parseInventoryQuery(params)
  const focusValue = params.get('focus') ?? ''
  const scope: CampaignScope = {
    customer: query.customer,
    vendor: query.vendor,
    contract: query.contract,
    focus: validFocus.has(focusValue as CampaignFocus) ? focusValue as CampaignFocus : '',
    page: query.page,
  }

  const [findings, filters] = await Promise.all([
    getDashboardWorkPackageFindings(query),
    getInventoryFilterOptions(),
  ])
  return (
    <FirmwareCampaignOverview
      scope={scope}
      filters={filters}
      campaigns={buildFirmwareCampaigns(findings)}
    />
  )
}
