import { notFound } from 'next/navigation'
import { DeviceTypeInventory } from '@/components/devices/inventory-explorer'
import {
  parseInventoryQuery,
  searchParamsToUrlSearchParams,
} from '@/lib/inventory-explorer'
import { getDeviceTypeInventory } from '@/lib/inventory-explorer-store'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{
    customerId: string
    siteId: string
    deviceTypeId: string
  }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DeviceTypeInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { customerId, siteId, deviceTypeId } = await params
  const query = parseInventoryQuery(
    searchParamsToUrlSearchParams(await searchParams),
  )
  const model = await getDeviceTypeInventory(
    customerId,
    siteId,
    deviceTypeId,
    query,
  )
  if (!model) notFound()
  return <DeviceTypeInventory model={model} query={query} />
}
