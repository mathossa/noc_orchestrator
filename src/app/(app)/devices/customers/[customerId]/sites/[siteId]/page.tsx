import { notFound } from 'next/navigation'
import { SiteInventory } from '@/components/devices/inventory-explorer'
import {
  parseInventoryQuery,
  searchParamsToUrlSearchParams,
} from '@/lib/inventory-explorer'
import { getSiteInventory } from '@/lib/inventory-explorer-store'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ customerId: string; siteId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SiteInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { customerId, siteId } = await params
  const query = parseInventoryQuery(
    searchParamsToUrlSearchParams(await searchParams),
  )
  const model = await getSiteInventory(customerId, siteId, query)
  if (!model) notFound()
  return <SiteInventory model={model} query={query} />
}
