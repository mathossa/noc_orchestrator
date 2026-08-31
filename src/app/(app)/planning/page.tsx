import { SectionPlaceholder } from '@/components/ui/section-placeholder'

export default function PlanningPage() {
  return (
    <SectionPlaceholder
      title="Planning"
      description="Operational lifecycle decisions: planned, ignored, customer declined, and done."
      emptyTitle="No lifecycle planning view yet"
      emptyDescription="Planning remains distinct from technical firmware state and will connect to lifecycle records later in the MVP."
    />
  )
}
