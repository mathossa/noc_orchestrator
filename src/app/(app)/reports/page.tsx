import {
  FirmwareReviewWorkspace,
  type FirmwareReviewWorkspaceFilters,
} from '@/components/firmware/reports/firmware-review-workspace'
import { listFirmwareReviewWorkspace } from '@/lib/firmware-review-store'

export const dynamic = 'force-dynamic'

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams
  const filters: FirmwareReviewWorkspaceFilters = {
    q: first(params.q).slice(0, 200),
    review: first(params.review).toUpperCase(),
    attention: first(params.attention).toUpperCase(),
  }
  const rows = await listFirmwareReviewWorkspace()
  return <FirmwareReviewWorkspace rows={rows} filters={filters} />
}
