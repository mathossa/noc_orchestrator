import { ImportAutomationManager } from '@/components/settings/import-automation-manager'
import { PageHeader } from '@/components/ui/page-header'
import { getImporterV2AutomationAdminData } from '@/lib/importer-v2-automation-admin-store'

export const dynamic = 'force-dynamic'

export default async function ImportAutomationPage() {
  const data = await getImporterV2AutomationAdminData()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Import automation"
        description="Inspect and manage saved Importer v2 rules and remembered exact mappings. Changes are versioned so previous behavior remains auditable."
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations', href: '/settings/integrations' },
          { label: 'Import automation' },
        ]}
      />

      <ImportAutomationManager data={data} />
    </div>
  )
}
