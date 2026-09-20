import { notFound } from 'next/navigation'
import { CustomerInventory } from '@/components/devices/inventory-explorer'
import {
  parseInventoryQuery,
  searchParamsToUrlSearchParams,
} from '@/lib/inventory-explorer'
import { getCustomerInventory } from '@/lib/inventory-explorer-store'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ customerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CustomerInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { customerId } = await params
  const query = parseInventoryQuery(
    searchParamsToUrlSearchParams(await searchParams),
  )
  const model = await getCustomerInventory(customerId, query)
  if (!model) notFound()
  return <CustomerInventory model={model} query={query} />
}
