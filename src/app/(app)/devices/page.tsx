import { SectionPlaceholder } from '@/components/ui/section-placeholder'

export default function DevicesPage() {
  return (
    <SectionPlaceholder
      title="Devices"
      description="Manual and synchronized device inventory with recorded current firmware state."
      emptyTitle="Device inventory is not connected yet"
      emptyDescription="This route is reserved and uses the shared shell. Manual inventory arrives in the dedicated device issue."
    />
  )
}
