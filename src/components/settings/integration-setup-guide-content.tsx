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
  const vendorPath = provider === 'auvik'
    ? ['Manage users', 'API access role', 'User profile', 'Generate API key']
    : ['Administrators', 'Read-only role', 'API & Webhooks', 'Generate API key']

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-[var(--muted-strong)]">{guide.intro}</p>

      <figure aria-label="API connection setup sequence" className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
        <svg
          viewBox="0 0 680 134"
          role="img"
          aria-label={`Illustrated ${guide.title} menu path: ${vendorPath.join(' then ')}`}
          className="h-auto w-full"
        >
          {vendorPath.map((label, index) => {
            const x = 12 + index * 169
            return (
              <g key={label}>
                <rect x={x} y={16} width={145} height={96} rx={9}
                  stroke="var(--border-strong)" strokeWidth={1.5} fill="var(--surface)" />
                <circle cx={x + 24} cy={39} r={12} stroke="var(--accent)"
                  fill="var(--accent-soft)" />
                <text x={x + 24} y={43} textAnchor="middle" fontSize={12}
                  fontWeight={700} fill="var(--accent-light)">{index + 1}</text>
                <text x={x + 72} y={73} fontSize={12} textAnchor="middle"
                  fontWeight={600} fill="var(--foreground)">{label}</text>
                {index < 3 ? (
                  <path d={`M${x + 150} 64 h13 m-5 -4 5 4 -5 4`}
                    stroke="var(--accent-light)" strokeWidth={2}
                    fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
              </g>
            )
          })}
        </svg>
        <figcaption className="text-xs leading-5 text-[var(--muted)]">
          Illustrated vendor menu path, not a screenshot. Copy the generated key into
          NOC Orchestrator, then Test connection and choose the intended sites.
        </figcaption>
      </figure>

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
