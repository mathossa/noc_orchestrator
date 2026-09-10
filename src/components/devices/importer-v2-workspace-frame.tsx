'use client'

import { useState } from 'react'
import { ImporterV2PublicationPanel } from '@/components/devices/importer-v2-publication-panel'
import { ImporterV2WorkspaceShell } from '@/components/devices/importer-v2-workspace-shell'
import styles from './importer-v2-workspace-frame.module.css'

type WorkspaceView = 'compact' | 'evidence'
type MaintenanceAction = 'automation' | 'recheck'
type MaintenanceResult = {
  checked: number
  valid: number
  warning: number
  review: number
  excluded: number
  stacks?: number
  stackMembers?: number
  automaticDecisionsApplied?: number
  topologyDecisionsApplied?: number
  detectedStackGroups?: number
  detectedStackMembers?: number
}

function maintenanceMessage(action: MaintenanceAction, result: MaintenanceResult) {
  if (action === 'automation') {
    const applied = result.automaticDecisionsApplied ?? 0
    const detectedStacks = result.detectedStackGroups ?? result.stacks ?? 0
    const detectedMembers = result.detectedStackMembers ?? result.stackMembers ?? 0
    const topologySummary = detectedStacks > 0
      ? ` Detected ${detectedStacks.toLocaleString()} logical stack${detectedStacks === 1 ? '' : 's'} with ${detectedMembers.toLocaleString()} physical member row${detectedMembers === 1 ? '' : 's'}; members will publish under their stack instead of as separate devices.`
      : ''
    if (applied === 0) {
      return `No new saved automation matched this batch.${topologySummary} Current result: ${result.valid.toLocaleString()} valid · ${result.review.toLocaleString()} review · ${result.warning.toLocaleString()} warning.`
    }
    return `Applied ${applied.toLocaleString()} new automated decision${applied === 1 ? '' : 's'}.${topologySummary} ${result.valid.toLocaleString()} valid · ${result.review.toLocaleString()} review · ${result.warning.toLocaleString()} warning.`
  }
  if (result.checked === 0) {
    return 'No corrections are waiting for recheck. New manual fixes are rechecked automatically.'
  }
  return `Rechecked ${result.checked.toLocaleString()} corrected row${result.checked === 1 ? '' : 's'}. ${result.valid.toLocaleString()} valid · ${result.review.toLocaleString()} review · ${result.warning.toLocaleString()} warning.`
}

export function ImporterV2WorkspaceFrame({ batchId }: { batchId: string }) {
  const [view, setView] = useState<WorkspaceView>('compact')
  const [publicationOpen, setPublicationOpen] = useState(false)
  const [maintenanceBusy, setMaintenanceBusy] = useState<MaintenanceAction | null>(null)
  const [maintenanceStatus, setMaintenanceStatus] = useState<string | null>(null)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)

  const runMaintenance = async (action: MaintenanceAction) => {
    setMaintenanceBusy(action)
    setMaintenanceStatus(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/${action}`,
        { method: 'POST' },
      )
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body?.error?.message ?? 'Importer maintenance failed.')
      }
      const result = body.data as MaintenanceResult
      setMaintenanceStatus(maintenanceMessage(action, result))
      setWorkspaceRevision((current) => current + 1)
    } catch (error) {
      setMaintenanceStatus(
        error instanceof Error ? error.message : 'Importer maintenance failed.',
      )
    } finally {
      setMaintenanceBusy(null)
    }
  }

  return (
    <div
      className={[
        styles.workspace,
        view === 'compact' ? styles.compact : styles.evidence,
      ].join(' ')}
    >
      <section className={styles.workbenchBar} aria-label="Importer workspace controls">
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>View</span>
          <div className={styles.segmentedControl}>
            <button
              type="button"
              onClick={() => setView('compact')}
              className={[
                styles.viewButton,
                view === 'compact' ? styles.viewButtonActive : '',
              ].join(' ')}
              aria-pressed={view === 'compact'}
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => setView('evidence')}
              className={[
                styles.viewButton,
                view === 'evidence' ? styles.viewButtonActive : '',
              ].join(' ')}
              aria-pressed={view === 'evidence'}
            >
              Evidence
            </button>
          </div>
        </div>

        <div className={styles.batchControls}>
          <span className={styles.controlLabel}>Batch</span>
          <button
            type="button"
            onClick={() => void runMaintenance('automation')}
            className={styles.viewButton}
            disabled={maintenanceBusy !== null}
            title="Apply topology detection, remembered exact mappings and active guided importer rules to this staged batch."
          >
            {maintenanceBusy === 'automation'
              ? 'Applying…'
              : 'Apply saved automations'}
          </button>
          <button
            type="button"
            onClick={() => void runMaintenance('recheck')}
            className={styles.viewButton}
            disabled={maintenanceBusy !== null}
            title="Re-evaluate any older staged corrections still marked for recheck. New fixes are rechecked automatically."
          >
            {maintenanceBusy === 'recheck' ? 'Rechecking…' : 'Recheck corrections'}
          </button>
          <button
            type="button"
            onClick={() => setPublicationOpen(true)}
            className={[styles.viewButton, styles.publishButton].join(' ')}
          >
            Final QA / Publish
          </button>
        </div>

        {maintenanceStatus ? (
          <p className={styles.maintenanceStatus} role="status">
            {maintenanceStatus}
          </p>
        ) : null}
      </section>

      <ImporterV2WorkspaceShell key={workspaceRevision} batchId={batchId} />

      {publicationOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/75 p-4 sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPublicationOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-publication-dialog-title"
            className="my-auto w-full max-w-6xl rounded-xl border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-xl border-b border-[var(--border)] bg-[var(--background)] px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--accent-light)]">
                  Importer v2
                </div>
                <h2
                  id="import-publication-dialog-title"
                  className="text-base font-semibold text-[var(--foreground)]"
                >
                  Final QA and publication
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPublicationOpen(false)}
                className={styles.viewButton}
                aria-label="Close final QA"
              >
                Close
              </button>
            </div>
            <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-4">
              <ImporterV2PublicationPanel batchId={batchId} embedded />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
