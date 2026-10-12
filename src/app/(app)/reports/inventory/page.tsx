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
