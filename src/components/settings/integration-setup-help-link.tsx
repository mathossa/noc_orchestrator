'use client'

import { useState } from 'react'
import { IntegrationSetupGuideContent } from '@/components/settings/integration-setup-guide-content'
import { Modal } from '@/components/ui/modal'
import {
  integrationSetupGuides,
  type IntegrationSetupProvider,
} from '@/lib/integration-setup-guides'

/** Context help is a dialog, not navigation: unsaved connection fields remain mounted. */
export function IntegrationSetupHelpLink({
  provider,
}: {
  provider: IntegrationSetupProvider
}) {
  const [open, setOpen] = useState(false)
  const guide = integrationSetupGuides[provider]
  const title = `API setup: ${guide.title}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`API setup help for ${guide.title}`}
        title={`How to create API credentials for ${guide.title}`}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-sm font-bold text-[var(--muted-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <span aria-hidden="true">?</span>
      </button>
      {open ? (
        <Modal title={title} panel onClose={() => setOpen(false)}>
          <div className="space-y-5">
            <IntegrationSetupGuideContent provider={provider} />
            <button type="button" onClick={() => setOpen(false)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-muted)]">
              Back to connection
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
