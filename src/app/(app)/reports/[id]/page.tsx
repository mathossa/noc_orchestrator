import { notFound } from 'next/navigation'
import { FirmwareReviewDetail } from '@/components/firmware/reports/firmware-review-detail'
import { getFirmwareReviewCycle } from '@/lib/firmware-review-store'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function FirmwareReviewDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params
  const query = await searchParams
  const cycle = await getFirmwareReviewCycle(id)
  if (!cycle) notFound()

  const requested = Number(first(query.version))
  const selectedReport =
    Number.isSafeInteger(requested) && requested > 0
      ? cycle.reports.find((report) => report.version === requested) ?? null
      : cycle.reports[0] ?? null

  if (
    Number.isSafeInteger(requested) &&
    requested > 0 &&
    !selectedReport
  )
    notFound()

  return (
    <FirmwareReviewDetail cycle={cycle} selectedReport={selectedReport} />
  )
}
