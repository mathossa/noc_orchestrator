import { buildInventoryReport, type InventoryReport } from '@/lib/inventory-report'
import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'

export type ContractReportDefinition = {
  name: string
  showInReport?: boolean
}

export type ContractReportSection = {
  key: string
  title: string
  report: InventoryReport
}

function contractName(value: string) {
  return value.normalize('NFKC').trim()
}

function compareName(left: string, right: string) {
  return left.localeCompare(right, 'en', {
    sensitivity: 'base',
    numeric: true,
  })
}

/**
 * Report sections are explicitly configured by Contract Type.
 *
 * A named contract is included only when "Show in report" is enabled. The
 * Contract Type name becomes the report/Excel section name. Devices without
 * any effective Contract Type always remain visible in "No contract".
 */
export function buildContractReportSections(
  rows: InventoryExportRecord[],
  configuredContracts: ContractReportDefinition[] = [],
): ContractReportSection[] {
  const names = new Set<string>()

  for (const contract of configuredContracts) {
    const name = contractName(contract.name)
    if (contract.showInReport && name) names.add(name)
  }

  // Keep assigned archived contract types reportable when their stored setting
  // is still enabled, even if they are no longer present in active filter data.
  for (const row of rows) {
    const name = contractName(row.contract)
    if (row.contractShowInReport && name) names.add(name)
  }

  const sections = [...names]
    .sort(compareName)
    .map((name) => ({
      key: 'contract:' + name,
      title: name,
      report: buildInventoryReport(
        rows.filter((row) => contractName(row.contract) === name),
      ),
    }))

  sections.push({
    key: 'no-contract',
    title: 'No contract',
    report: buildInventoryReport(
      rows.filter((row) => contractName(row.contract) === ''),
    ),
  })

  return sections
}
