import { notFound } from 'next/navigation'
import { IntegrationSetupGuideContent } from '@/components/settings/integration-setup-guide-content'
import { ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import {
  integrationSetupGuides,
  isIntegrationSetupProvider,
} from '@/lib/integration-setup-guides'

export function generateStaticParams() {
  return Object.keys(integrationSetupGuides).map((provider) => ({ provider }))
}

export default async function IntegrationSetupHelpPage({
  params,
}: {
  params: Promise<{ provider: string }>
}) {
  const { provider } = await params
  if (!isIntegrationSetupProvider(provider)) notFound()

  const guide = integrationSetupGuides[provider]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings · Integrations · API setup"
        title={`API setup: ${guide.title}`}
        description={guide.subtitle}
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations', href: '/settings/integrations' },
          { label: 'API setup' },
          { label: guide.title },
        ]}
        actions={<ButtonLink href={guide.addConnectionHref}>Add connection</ButtonLink>}
      />
      <div className="max-w-4xl">
        <IntegrationSetupGuideContent provider={provider} />
      </div>
    </div>
  )
}
