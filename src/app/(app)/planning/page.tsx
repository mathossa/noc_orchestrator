import { FirmwarePlanList } from '@/components/firmware/planning/firmware-plan-list'

type PlanningPageProps = {
  searchParams: Promise<{ view?: string }>
}

export default async function PlanningPage({
  searchParams,
}: PlanningPageProps) {
  const params = await searchParams
  return (
    <FirmwarePlanList
      initialView={params.view === 'history' ? 'history' : 'active'}
    />
  )
}
