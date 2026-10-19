import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { parseInventoryQuery } from '@/lib/inventory-explorer'
import { buildFirmwareCampaigns } from '@/lib/dashboard-firmware-campaigns'
import { getDashboardWorkPackageFindings, getInventoryFilterOptions } from '@/lib/inventory-explorer-store'

export const dynamic = 'force-dynamic'

type RouteProps = { params: Promise<{ id: string }> }

function safeCell(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\r?\n/g, ' ').trim()
  // Prevent spreadsheet formula injection in untrusted customer/device names.
  const safe = /^[=+@\-\t]/.test(text) ? "'" + text : text
  return '"' + safe.replace(/"/g, '""') + '"'
}

export async function GET(request: Request, { params }: RouteProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) notFound()

  const { id } = await params
  const requestUrl = new URL(request.url)
  const source = requestUrl.searchParams
  const query = parseInventoryQuery(new URLSearchParams({
    customer: source.get('scopeCustomer') ?? '',
    vendor: source.get('scopeVendor') ?? '',
    contract: source.get('scopeContract') ?? '',
  }))
  const [findings, filters] = await Promise.all([
    getDashboardWorkPackageFindings(query),
    getInventoryFilterOptions(),
  ])
  const campaign = buildFirmwareCampaigns(findings).find((row) => row.id === id)
  if (!campaign) notFound()

  const release = source.get('release') ?? ''
  const customer = source.get('customer') ?? ''
  const contractNames = new Map(filters.contracts.map((contract) => [contract.id, contract.name]))
  const selected = campaign.findings.filter((device) =>
    (!release || (device.currentFirmwareVersion ?? 'Onbekend') === release) &&
    (!customer || device.customer.id === customer),
  )
  const headings = [
    'Customer', 'Site', 'Device', 'Device ID', 'Vendor', 'Model',
    'Current firmware', 'Source train', 'Approved target', 'Contract',
    'Technical status', 'Workflow', 'Plan ID',
  ]
  const rows = selected.map((device) => [
    device.customer.name,
    device.site?.name ?? '',
    device.deviceName ?? device.deviceId,
    device.deviceId,
    device.vendor.name,
    device.model.name,
    device.currentFirmwareVersion ?? 'Onbekend',
    device.currentTrain ?? campaign.sourceTrain,
    device.targetVersion ?? '',
    device.managementContractId
      ? contractNames.get(device.managementContractId) ?? 'Onbekend'
      : 'Geen contract',
    device.status,
    device.plan?.state ?? device.workflowState ?? 'Niet gepland',
    device.plan?.id ?? '',
  ])
  const csv = '\uFEFF' + [headings, ...rows]
    .map((cells) => cells.map(safeCell).join(';'))
    .join('\r\n') + '\r\n'

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="firmware-campaign-' + id + '.csv"',
      'cache-control': 'no-store',
    },
  })
}
