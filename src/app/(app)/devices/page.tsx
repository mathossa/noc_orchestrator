import { InventoryOverview } from '@/components/devices/inventory-explorer'
import {
  parseInventoryQuery,
  searchParamsToUrlSearchParams,
} from '@/lib/inventory-explorer'
import { getInventoryOverview } from '@/lib/inventory-explorer-store'

type DevicesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DevicesPage({ searchParams }: DevicesPageProps) {
  const query = parseInventoryQuery(
    searchParamsToUrlSearchParams(await searchParams),
  )
  const model = await getInventoryOverview(query)
  return <InventoryOverview model={model} query={query} />
}
