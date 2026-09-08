'use client'

import { useState } from 'react'
import { ImporterV2PublicationPanel } from '@/components/devices/importer-v2-publication-panel'
import { ImporterV2WorkspaceShell } from '@/components/devices/importer-v2-workspace-shell'
import styles from './importer-v2-workspace-frame.module.css'

type WorkspaceView = 'compact' | 'evidence'

export function ImporterV2WorkspaceFrame({ batchId }: { batchId: string }) {
  const [view, setView] = useState<WorkspaceView>('compact')
  const [publicationOpen, setPublicationOpen] = useState(false)

  return (
    <div
      className={[
        styles.workspace,
        view === 'compact' ? styles.compact : styles.evidence,
      ].join(' ')}
    >
      <div className={styles.viewToolbar} aria-label="Importer table view">
        <button
          type="button"
          onClick={() => setView('compact')}
          className={[
            styles.viewButton,
            view === 'compact' ? styles.viewButtonActive : '',
          ].join(' ')}
          aria-pressed={view === 'compact'}
        >
          Compact view
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
          Evidence columns
        </button>
        <button
          type="button"
          onClick={() => setPublicationOpen(true)}
          className={styles.viewButton}
        >
          Final QA / Publish
        </button>
      </div>

      <ImporterV2WorkspaceShell batchId={batchId} />

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
