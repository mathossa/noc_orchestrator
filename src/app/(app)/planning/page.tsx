import { FirmwarePlanningWorkspace } from '@/components/firmware/firmware-planning-workspace'

type PlanningPageProps = {
  searchParams: Promise<{ view?: string }>
}

export default async function PlanningPage({
  searchParams,
}: PlanningPageProps) {
  const params = await searchParams
  return (
    <FirmwarePlanningWorkspace
      initialView={params.view === 'history' ? 'history' : 'active'}
    />
  )
}
