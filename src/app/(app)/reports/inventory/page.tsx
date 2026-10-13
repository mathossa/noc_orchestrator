import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { InventoryReportView } from '@/components/firmware/reports/inventory-report-view'
import {
  parseInventoryQuery,
  searchParamsToUrlSearchParams,
} from '@/lib/inventory-explorer'
import {
  getInventoryExportRecords,
  getInventoryFilterOptions,
} from '@/lib/inventory-explorer-store'
import {
  buildInventoryReport,
  filterInventoryReportRows,
} from '@/lib/inventory-report'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function InventoryReportPage({ searchParams }: PageProps) {
  // A cross-customer report may contain internal contracts and device identities.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) notFound()

  const params = searchParamsToUrlSearchParams(await searchParams)
  const query = parseInventoryQuery(params)
  const firmware = (params.get('firmware') ?? '').normalize('NFKC').trim().slice(0, 100)
  const [allMatchingRows, filters] = await Promise.all([
    getInventoryExportRecords({ kind: 'all' }, query),
    getInventoryFilterOptions(),
  ])
  const report = buildInventoryReport(filterInventoryReportRows(allMatchingRows, firmware))

  return (
    <InventoryReportView
      report={report}
      filters={filters}
      query={query}
      firmware={firmware}
      generatedAt={new Date().toISOString()}
    />
  )
}
