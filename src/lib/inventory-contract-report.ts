import { buildInventoryReport, type InventoryReport } from '@/lib/inventory-report'
import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'

export type ContractReportCategory = 'PRO_ACTIVE' | 'ACTIVE' | 'NO_CONTRACT' | 'OTHER'

export type ContractReportSection = {
  category: ContractReportCategory
  title: string
  report: InventoryReport
}

const categories: Array<{ category: ContractReportCategory; title: string }> = [
  { category: 'PRO_ACTIVE', title: 'Pro-active' },
  { category: 'ACTIVE', title: 'Active' },
  { category: 'NO_CONTRACT', title: 'No contract' },
  { category: 'OTHER', title: 'Other contracts' },
]

/**
 * Classification is intentionally conservative: an unknown *configured* service
 * contract is NOT the same as having no contract.
 */
export function contractReportCategory(contract: string): ContractReportCategory {
  const normalized = contract.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!normalized || normalized === 'nocontract' || normalized === 'geencontract') {
    return 'NO_CONTRACT'
  }
  if (normalized.startsWith('proactive') || normalized.startsWith('proactief')) {
    return 'PRO_ACTIVE'
  }
  if (normalized.startsWith('active') || normalized.startsWith('actief')) {
    return 'ACTIVE'
  }
  return 'OTHER'
}

export function buildContractReportSections(
  rows: InventoryExportRecord[],
): ContractReportSection[] {
  const byCategory = new Map<ContractReportCategory, InventoryExportRecord[]>([
    ['PRO_ACTIVE', []],
    ['ACTIVE', []],
    ['NO_CONTRACT', []],
    ['OTHER', []],
  ])
  for (const device of rows) {
    byCategory.get(contractReportCategory(device.contract))!.push(device)
  }
  return categories
    .filter(({ category }) => category !== 'OTHER' || byCategory.get('OTHER')!.length > 0)
    .map(({ category, title }) => ({
      category,
      title,
      report: buildInventoryReport(byCategory.get(category)!),
    }))
}
