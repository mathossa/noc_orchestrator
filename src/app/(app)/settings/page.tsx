import { ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Configuration for integrations and organization-level behavior."
      />

      <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Integrations</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Configure inventory source definitions and inspect Inventory Sync Profiles.
          </p>
        </div>
        <ButtonLink href="/settings/integrations">Open integrations</ButtonLink>
      </section>
    </div>
  )
}
