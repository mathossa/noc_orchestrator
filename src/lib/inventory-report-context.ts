import type {
  InventoryFilterOptions,
  InventoryQuery,
} from '@/lib/inventory-explorer'

function readableStatus(value: string) {
  return value.toLowerCase().replaceAll('_', ' ')
}

export function inventoryReportScopeDescription(
  query: InventoryQuery,
  filters: InventoryFilterOptions,
  firmware: string,
) {
  const vendorName = filters.vendors.find((item) => item.id === query.vendor)?.name
  const typeName = filters.deviceTypes.find((item) => item.id === query.deviceType)?.name
  const modelName = filters.models.find((item) => item.id === query.model)?.model
  const contractName = filters.contracts.find((item) => item.id === query.contract)?.name

  return [
    query.vendor ? vendorName ?? 'Vendor ' + query.vendor : null,
    query.deviceType ? typeName ?? 'Type ' + query.deviceType : null,
    query.model ? modelName ?? 'Model ' + query.model : null,
    query.contract === 'none' ? 'No management contract' : query.contract ? contractName ?? 'Contract ' + query.contract : null,
    firmware ? 'Firmware contains ' + firmware : null,
    query.status ? 'Status: ' + readableStatus(query.status) : null,
    query.source ? 'Source: ' + readableStatus(query.source) : null,
    query.attention ? 'Needs attention' : null,
    query.flagged ? 'Flagged' : null,
    query.q ? 'Search: ' + query.q : null,
  ].filter(Boolean).join(' · ') || 'All managed inventory'
}
