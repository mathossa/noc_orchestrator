import { notFound } from 'next/navigation'
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
        meta={<span>Instructions reviewed {guide.reviewedOn}</span>}
      />

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">Before you begin</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted-strong)]">{guide.intro}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--foreground)]">
          {guide.requirements.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      {guide.sections.map((section) => (
        <section key={section.title} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-base font-semibold">{section.title}</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-[var(--muted-strong)]">
            {section.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </section>
      ))}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">Troubleshooting and credential rotation</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted-strong)]">
          {guide.troubleshooting.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">Official vendor references</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Vendor menus and permission names may change. Check these primary sources before provisioning a new account.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {guide.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent-light)] hover:underline"
              >
                {source.label} (opens in new tab)
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
