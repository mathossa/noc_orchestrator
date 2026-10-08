import {
  integrationSetupGuides,
  type IntegrationSetupProvider,
} from '@/lib/integration-setup-guides'

/**
 * Shared presentation for the full guide page and in-place help drawer.
 * The visual sequence is an orientation aid, not an interactive wizard.
 */
export function IntegrationSetupGuideContent({
  provider,
}: {
  provider: IntegrationSetupProvider
}) {
  const guide = integrationSetupGuides[provider]

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-[var(--muted-strong)]">{guide.intro}</p>

      <div aria-label="API connection setup sequence" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {['Account', 'API key', 'NOC connection', 'Test & sync'].map((label, index) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-light)]">
              {index + 1}
            </span>
            <div className="mt-2 text-xs font-semibold text-[var(--foreground)]">{label}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">You will need</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-[var(--muted-strong)]">
          {guide.requirements.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      {guide.sections.map((section) => (
        <section key={section.title} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-semibold text-[var(--foreground)]">{section.title}</h2>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-[var(--muted-strong)]">
            {section.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </section>
      ))}

      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer font-semibold text-[var(--foreground)]">
          Troubleshooting & credential rotation
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted-strong)]">
          {guide.troubleshooting.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>

      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer font-semibold text-[var(--foreground)]">
          Official vendor guides and screenshots
        </summary>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          For screenshots of the current vendor interface, open the official instructions below.
          Vendor menu labels can change over time.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {guide.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer"
                className="text-[var(--accent-light)] hover:underline">
                {source.label} (opens in new tab)
              </a>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-[var(--muted)]">References reviewed {guide.reviewedOn} · Never share API secrets in tickets or screenshots.</p>
    </div>
  )
}
