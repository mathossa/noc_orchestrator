import { MerakiConnectionCreateForm } from '@/components/settings/meraki-connection-create-form'
import { IntegrationSetupHelpLink } from '@/components/settings/integration-setup-help-link'
import { PageHeader } from '@/components/ui/page-header'
export default function NewMerakiConnectionPage() {
  return <div className="space-y-6">
    <PageHeader eyebrow="Settings · Integrations" title="Add Cisco Meraki connection"
      description="Create a Meraki Dashboard inventory source. The API credential remains server-side; observed inventory flows through Importer v2."
      alignActionsTop
        actions={<IntegrationSetupHelpLink provider="meraki" />}
      breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Integrations', href: '/settings/integrations' }, { label: 'Add Cisco Meraki connection' }]} />
    <MerakiConnectionCreateForm />
  </div>
}
