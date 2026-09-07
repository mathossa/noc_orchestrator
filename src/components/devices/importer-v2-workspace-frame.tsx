'use client'

import { useState } from 'react'
import { ImporterV2WorkspaceShell } from '@/components/devices/importer-v2-workspace-shell'
import styles from './importer-v2-workspace-frame.module.css'

type WorkspaceView = 'compact' | 'evidence'

export function ImporterV2WorkspaceFrame({ batchId }: { batchId: string }) {
  const [view, setView] = useState<WorkspaceView>('compact')

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
      </div>
      <ImporterV2WorkspaceShell batchId={batchId} />
    </div>
  )
}
