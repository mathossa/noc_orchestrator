import Link from 'next/link'
import {
  integrationSetupGuides,
  type IntegrationSetupProvider,
} from '@/lib/integration-setup-guides'

/** Small, keyboard-accessible context help affordance reused across integration screens. */
export function IntegrationSetupHelpLink({
  provider,
}: {
  provider: IntegrationSetupProvider
}) {
  const guide = integrationSetupGuides[provider]

  return (
    <Link
      href={`/settings/integrations/help/${provider}`}
      aria-label={`API setup help for ${guide.title}`}
      title={`How to create API credentials for ${guide.title}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-sm font-bold text-[var(--muted-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <span aria-hidden="true">?</span>
    </Link>
  )
}
