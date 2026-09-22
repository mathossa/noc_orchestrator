import { FirmwarePlanDetail } from '@/components/firmware/planning/firmware-plan-detail'

type PlanningDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function PlanningDetailPage({
  params,
}: PlanningDetailPageProps) {
  const { id } = await params
  return <FirmwarePlanDetail planId={id} />
}
