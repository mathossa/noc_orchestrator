import { inventoryExportCsv } from '@/lib/inventory-export'
import { parseInventoryQuery } from '@/lib/inventory-explorer'
import {
  getInventoryExportRecords,
  type InventoryExportScope,
} from '@/lib/inventory-explorer-store'

function exportScope(params: URLSearchParams): InventoryExportScope | null {
  const scope = params.get('scope')
  const customerId = params.get('customerId')
  if (!customerId) return null

  if (scope === 'customer') {
    return { kind: 'customer', customerId }
  }

  const siteId = params.get('siteId')
  if (!siteId) return null
  if (scope === 'site') {
    return { kind: 'site', customerId, siteId }
  }

  const deviceTypeId = params.get('deviceTypeId')
  if (scope === 'deviceType' && deviceTypeId) {
    return {
      kind: 'deviceType',
      customerId,
      siteId,
      deviceTypeId,
    }
  }

  return null
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const scope = exportScope(params)
  if (!scope) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Choose a valid customer, site, or device-type export scope.',
        },
      },
      { status: 400 },
    )
  }

  const rows = await getInventoryExportRecords(
    scope,
    parseInventoryQuery(params),
  )
  const filename =
    'noc-inventory-' +
    scope.kind.toLowerCase() +
    '-' +
    new Date().toISOString().slice(0, 10) +
    '.csv'

  return new Response(inventoryExportCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="' + filename + '"',
      'cache-control': 'no-store',
    },
  })
}
