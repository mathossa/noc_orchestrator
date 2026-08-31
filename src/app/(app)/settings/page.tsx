import { SectionPlaceholder } from '@/components/ui/section-placeholder'

export default function SettingsPage() {
  return (
    <SectionPlaceholder
      title="Settings"
      description="Configuration for reference data, integrations, and future organization-level behavior."
      emptyTitle="Settings are not connected yet"
      emptyDescription="Configuration screens will reuse the form and confirmation primitives established by this shell."
    />
  )
}
