import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'

export type InventoryReportDistribution = { label: string; count: number }
export type InventoryReportSite = {
  id: string | null
  name: string
  devices: InventoryExportRecord[]
}
export type InventoryReportCustomer = {
  id: string
  name: string
  sites: InventoryReportSite[]
  deviceCount: number
}

export type InventoryReport = {
  devices: InventoryExportRecord[]
  customers: InventoryReportCustomer[]
  customerCount: number
  siteCount: number
  deviceCount: number
  unknownFirmwareCount: number
  missingContractCount: number
  firmwareDistribution: InventoryReportDistribution[]
  contractDistribution: InventoryReportDistribution[]
  statusDistribution: InventoryReportDistribution[]
}

export function filterInventoryReportRows(
  rows: InventoryExportRecord[],
  firmwareQuery: string,
): InventoryExportRecord[] {
  const version = firmwareQuery.normalize('NFKC').trim().toLocaleLowerCase()
  if (!version) return rows
  // Text filtering is not CVE or upgrade-path applicability. #104 owns that.
  return rows.filter((row) =>
    row.currentFirmware.normalize('NFKC').toLocaleLowerCase().includes(version),
  )
}

function countBy(
  rows: InventoryExportRecord[],
  selector: (row: InventoryExportRecord) => string,
  fallback: string,
): InventoryReportDistribution[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const label = selector(row).trim() || fallback
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label),
  )
}

export function buildInventoryReport(rows: InventoryExportRecord[]): InventoryReport {
  const devices = [...rows].sort(
    (left, right) =>
      left.customer.localeCompare(right.customer) ||
      left.customerId.localeCompare(right.customerId) ||
      left.site.localeCompare(right.site) ||
      (left.siteId ?? '').localeCompare(right.siteId ?? '') ||
      left.name.localeCompare(right.name) ||
      left.deviceId.localeCompare(right.deviceId),
  )
  const customerById = new Map<
    string,
    { customer: InventoryReportCustomer; siteById: Map<string, InventoryReportSite> }
  >()

  for (const device of devices) {
    let entry = customerById.get(device.customerId)
    if (!entry) {
      entry = {
        customer: {
          id: device.customerId,
          name: device.customer,
          sites: [],
          deviceCount: 0,
        },
        siteById: new Map(),
      }
      customerById.set(device.customerId, entry)
    }
    const siteKey = device.siteId ?? '__UNASSIGNED__'
    let site = entry.siteById.get(siteKey)
    if (!site) {
      site = { id: device.siteId, name: device.site, devices: [] }
      entry.siteById.set(siteKey, site)
      entry.customer.sites.push(site)
    }
    site.devices.push(device)
    entry.customer.deviceCount += 1
  }

  const customers = [...customerById.values()].map((entry) => entry.customer)
  return {
    devices,
    customers,
    customerCount: customers.length,
    siteCount: customers.reduce(
      (sum, customer) => sum + customer.sites.filter((site) => site.id !== null).length,
      0,
    ),
    deviceCount: devices.length,
    unknownFirmwareCount: devices.filter((device) => !device.currentFirmware.trim()).length,
    missingContractCount: devices.filter((device) => !device.contract.trim()).length,
    firmwareDistribution: countBy(devices, (device) => device.currentFirmware, 'Unknown'),
    contractDistribution: countBy(devices, (device) => device.contract, 'No management contract'),
    statusDistribution: countBy(devices, (device) => device.primaryStatus, 'Unknown'),
  }
}
