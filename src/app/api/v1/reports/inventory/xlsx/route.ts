import { auth } from '@/lib/auth'
import {
  parseInventoryQuery,
} from '@/lib/inventory-explorer'
import {
  getInventoryExportRecords,
  getInventoryFilterOptions,
} from '@/lib/inventory-explorer-store'
import { filterInventoryReportRows } from '@/lib/inventory-report'
import { inventoryReportScopeDescription } from '@/lib/inventory-report-context'
import { inventoryReportXlsx } from '@/lib/inventory-report-xlsx'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  // These workbook exports include confidential cross-customer inventory.
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } },
      { status: 401 },
    )
  }

  const params = new URL(request.url).searchParams
  const query = parseInventoryQuery(params)
  const firmware = (params.get('firmware') ?? '').normalize('NFKC').trim().slice(0, 100)
  const [allRows, filters] = await Promise.all([
    getInventoryExportRecords({ kind: 'all' }, query),
    getInventoryFilterOptions(),
  ])
  const rows = filterInventoryReportRows(allRows, firmware)
  const generatedAt = new Date().toISOString()
  const workbook = await inventoryReportXlsx(
    rows,
    generatedAt,
    inventoryReportScopeDescription(query, filters, firmware),
    filters.contracts,
  )

  return new Response(new Uint8Array(workbook), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="noc-inventory-report-' +
        generatedAt.slice(0, 10) + '.xlsx"',
      'cache-control': 'no-store',
    },
  })
}
