import { AuvikConnectionCreateForm } from '@/components/settings/auvik-connection-create-form'
import { IntegrationSetupHelpLink } from '@/components/settings/integration-setup-help-link'
import { PageHeader } from '@/components/ui/page-header'

export default function NewAuvikConnectionPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings · Integrations"
        title="Add Auvik connection"
        description="Create an Auvik Network Management inventory source. Credentials remain server-side; observed inventory will flow through Importer v2."
        actions={<IntegrationSetupHelpLink provider="auvik" />}
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations', href: '/settings/integrations' },
          { label: 'Add Auvik connection' },
        ]}
      />
      <AuvikConnectionCreateForm />
    </div>
  )
}
