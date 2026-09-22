import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'

const columns: Array<{
  header: string
  value: (row: InventoryExportRecord) => string
}> = [
  { header: 'Customer', value: (row) => row.customer },
  { header: 'Site', value: (row) => row.site },
  { header: 'Device type', value: (row) => row.deviceType },
  { header: 'Device', value: (row) => row.name },
  { header: 'Hostname', value: (row) => row.hostname },
  { header: 'Vendor', value: (row) => row.vendor },
  { header: 'Model', value: (row) => row.model },
  { header: 'Serial number', value: (row) => row.serialNumber },
  { header: 'Management address', value: (row) => row.managementAddress },
  { header: 'Current firmware', value: (row) => row.currentFirmware },
  { header: 'Effective target', value: (row) => row.effectiveTarget },
  { header: 'Target platform', value: (row) => row.targetPlatform },
  { header: 'Target train', value: (row) => row.targetTrain },
  { header: 'Policy source / scope', value: (row) => row.policyContext },
  { header: 'Policy track', value: (row) => row.policyTrack },
  { header: 'Primary inventory status', value: (row) => row.primaryStatus },
  { header: 'Status reason', value: (row) => row.statusReason },
  { header: 'Technical compliance', value: (row) => row.technicalCompliance },
  { header: 'Recommendation', value: (row) => row.recommendation },
  { header: 'Exception state', value: (row) => row.exceptionState },
  { header: 'Exception reason', value: (row) => row.exceptionReason },
  { header: 'Workflow', value: (row) => row.workflow },
  { header: 'Contract', value: (row) => row.contract },
  { header: 'Source', value: (row) => row.source },
  { header: 'External provider', value: (row) => row.externalProvider },
  { header: 'External ID', value: (row) => row.externalId },
  { header: 'Last synchronized', value: (row) => row.lastSynchronizedAt },
]

function csvCell(value: string) {
  if (!/[",\r\n]/.test(value)) return value
  return '"' + value.replaceAll('"', '""') + '"'
}

export function inventoryExportCsv(rows: InventoryExportRecord[]) {
  const output = [columns.map((column) => csvCell(column.header)).join(',')]
  for (const row of rows) {
    output.push(columns.map((column) => csvCell(column.value(row))).join(','))
  }
  return '\uFEFF' + output.join('\r\n') + '\r\n'
}
