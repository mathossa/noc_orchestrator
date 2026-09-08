'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceFieldChange,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'
import type {
  ActionPreview,
  RowDetail,
} from '@/components/devices/importer-v2-workspace-client-types'

const CLIENT_FIELDS: readonly ImporterV2Field[] = [
  'customer',
  'businessUnit',
  'site',
  'deviceName',
  'hostname',
  'sourceId',
  'serialNumber',
  'macAddress',
  'vendor',
  'productFamily',
  'softwarePlatform',
  'model',
  'deviceType',
  'managementAddress',
  'currentFirmware',
  'firmwareVersion',
  'softwareVersion',
  'notes',
]

const ACTIONS = [
  ['SET_FIELD', 'Set field'],
  ['LINK_FIELD', 'Link canonical value'],
  ['CLEAR_FIELD', 'Clear field'],
  ['IGNORE_FIELD', 'Ignore source field'],
  ['CHANGE_SET', 'Edit multiple fields'],
  ['EXCLUDE_ROW', 'Exclude row/device'],
  ['REMEMBER_EXACT', 'Remember exact mapping'],
  ['CREATE_SCOPED_RULE', 'Create scoped rule'],
] as const

type ActionKind = (typeof ACTIONS)[number][0]
type InspectorTab = 'REVIEW' | 'EVIDENCE' | 'HISTORY'
type ChangeSetOperation =
  | 'SET_FIELD'
  | 'LINK_FIELD'
  | 'CLEAR_FIELD'
  | 'IGNORE_FIELD'
type RuleScopeDimension =
  | 'customer'
  | 'businessUnit'
  | 'site'
  | 'vendor'
  | 'model'
  | 'productFamily'
  | 'deviceType'
type IdentityCandidate = NonNullable<RowDetail['identityReview']>['candidates'][number]

type IdentityDecision = {
  kind: 'CONFIRM_MATCH' | 'CHOOSE_CANDIDATE' | 'CREATE_NEW' | 'MANUAL_OVERRIDE'
  canonicalDeviceId?: string | null
  explanation: string
}

type IdentityPreview = {
  scopeToken: string
  decision: IdentityDecision
  requiresConfirmation: true
}

type Props = {
  batchId: string
  selection: ImporterV2WorkspaceSelection | null
  selectionLabel: string
  detail: RowDetail | null
  detailLoading: boolean
  onRefresh: () => void
}

function display(value: string | null | undefined) {
  return value || '—'
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    businessUnit: 'Subdomain',
    deviceName: 'Device name',
    sourceId: 'Source ID',
    serialNumber: 'Serial number',
    macAddress: 'MAC address',
    productFamily: 'Product family',
    softwarePlatform: 'Software platform',
    deviceType: 'Device type',
    managementAddress: 'Management address',
    currentFirmware: 'Running firmware',
    firmwareVersion: 'Raw Firmware Version',
    softwareVersion: 'Raw Software Version',
  }
  return (
    labels[field] ??
    field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase())
  )
}

function identitySignalLabel(kind: string) {
  const labels: Record<string, string> = {
    SOURCE_ID: 'Source ID',
    sourceId: 'Source ID',
    SERIAL_NUMBER: 'Serial',
    serialNumber: 'Serial',
    MAC_ADDRESS: 'MAC',
    macAddress: 'MAC',
  }
  return labels[kind] ?? fieldLabel(kind)
}

function identitySignalState(status: string | null) {
  switch (status) {
    case 'AGREE':
      return 'MATCH'
    case 'DISAGREE':
      return 'DIFFERENT'
    case 'MISSING':
      return 'MISSING'
    default:
      return status ?? '—'
  }
}

function candidateContextValue(
  detail: RowDetail,
  candidate: IdentityCandidate,
  field: string,
) {
  const difference = candidate.contextDifferences.find(
    (item) => item.field === field,
  )
  if (difference) return difference.candidateValue
  return detail.evaluated.rawValues?.[field] ?? null
}

function candidateTitle(detail: RowDetail, candidate: IdentityCandidate) {
  const name =
    candidateContextValue(detail, candidate, 'deviceName') ??
    candidateContextValue(detail, candidate, 'hostname')
  const model = candidateContextValue(detail, candidate, 'model')
  if (name && model && name !== model) return `${name} · ${model}`
  return name ?? model ?? 'Existing device'
}

function candidateLocation(detail: RowDetail, candidate: IdentityCandidate) {
  const customer = candidateContextValue(detail, candidate, 'customer')
  const site = candidateContextValue(detail, candidate, 'site')
  return [customer, site].filter(Boolean).join(' · ')
}

function changeSetOperationLabel(value: ChangeSetOperation) {
  const labels: Record<ChangeSetOperation, string> = {
    SET_FIELD: 'Set field',
    LINK_FIELD: 'Link canonical value',
    CLEAR_FIELD: 'Clear field',
    IGNORE_FIELD: 'Ignore source field',
  }
  return labels[value]
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Request failed.')
  }
  return body.data as T
}

function decisionValue(value: unknown) {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>
    if (typeof candidate.label === 'string') return candidate.label
    if (typeof candidate.canonicalDeviceId === 'string') {
      return candidate.canonicalDeviceId
    }
    if (typeof candidate.kind === 'string') return candidate.kind
  }
  return JSON.stringify(value)
}

function StatusReason({ detail }: { detail: RowDetail }) {
  const identityRequired = detail.identityReview?.requiresConfirmation ?? false
  const errorCount = detail.activeErrorCount ?? 0
  const warningCount = detail.activeWarningCount ?? 0
  const reasons: string[] = []
  if (errorCount) reasons.push(`${errorCount} active error${errorCount === 1 ? '' : 's'}`)
  if (identityRequired) reasons.push('identity confirmation required')
  if (warningCount) reasons.push(`${warningCount} active warning${warningCount === 1 ? '' : 's'}`)
  if (detail.needsReevaluation) reasons.push('re-evaluation pending')
  if (!reasons.length) return null

  return (
    <div className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-3 text-xs">
      <p className="font-semibold text-[var(--foreground)]">
        Why this row is {detail.primaryStatus.replaceAll('_', ' ')}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-[var(--muted-strong)]">
        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </div>
  )
}

export function ImporterV2Inspector({
  batchId,
  selection,
  selectionLabel,
  detail,
  detailLoading,
  onRefresh,
}: Props) {
  const [tab, setTab] = useState<InspectorTab>('REVIEW')
  const [actionKind, setActionKind] = useState<ActionKind>('SET_FIELD')
  const [actionField, setActionField] = useState<ImporterV2Field>('model')
  const [targetLabel, setTargetLabel] = useState('')
  const [targetId, setTargetId] = useState('')
  const [explanation, setExplanation] = useState('Engineer reconciliation decision')
  const [changeSetOperation, setChangeSetOperation] = useState<ChangeSetOperation>('SET_FIELD')
  const [queuedChanges, setQueuedChanges] = useState<ImporterV2WorkspaceFieldChange[]>([])
  const [sourceValue, setSourceValue] = useState('')
  const [ruleScopeDimension, setRuleScopeDimension] = useState<RuleScopeDimension>('model')
  const [ruleScopeValue, setRuleScopeValue] = useState('')
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [previewAction, setPreviewAction] = useState<ImporterV2WorkspaceAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [identityChoice, setIdentityChoice] = useState('')
  const [identityManualId, setIdentityManualId] = useState('')
  const [identityExplanation, setIdentityExplanation] = useState('Confirmed durable identity evidence')
  const [identityPreview, setIdentityPreview] = useState<IdentityPreview | null>(null)
  const [identityBusy, setIdentityBusy] = useState(false)

  const draftChange = useMemo<ImporterV2WorkspaceFieldChange | null>(() => {
    const target = { id: targetId.trim() || null, label: targetLabel.trim() }
    if (changeSetOperation === 'SET_FIELD' || changeSetOperation === 'LINK_FIELD') {
      if (!target.label) return null
      return {
        type: changeSetOperation,
        field: actionField,
        value: target,
        explanation,
      }
    }
    return {
      type: changeSetOperation,
      field: actionField,
      explanation,
    }
  }, [actionField, changeSetOperation, explanation, targetId, targetLabel])

  const effectiveQueuedChanges = useMemo(() => {
    if (!draftChange) return queuedChanges
    return [
      ...queuedChanges.filter((change) => change.field !== draftChange.field),
      draftChange,
    ]
  }, [draftChange, queuedChanges])

  const action = useMemo<ImporterV2WorkspaceAction | null>(() => {
    const target = { id: targetId.trim() || null, label: targetLabel.trim() }
    if (actionKind === 'CHANGE_SET') {
      return effectiveQueuedChanges.length
        ? { type: 'CHANGE_SET', changes: effectiveQueuedChanges, explanation }
        : null
    }
    if (actionKind === 'EXCLUDE_ROW') return { type: 'EXCLUDE_ROW', explanation }
    if (actionKind === 'CLEAR_FIELD' || actionKind === 'IGNORE_FIELD') {
      return { type: actionKind, field: actionField, explanation }
    }
    if (actionKind === 'SET_FIELD' || actionKind === 'LINK_FIELD') {
      return target.label
        ? { type: actionKind, field: actionField, value: target, explanation }
        : null
    }
    if (actionKind === 'REMEMBER_EXACT') {
      return target.label && sourceValue.trim()
        ? {
            type: 'REMEMBER_EXACT',
            field: actionField,
            normalizedInput: sourceValue.trim(),
            value: target,
            explanation,
          }
        : null
    }
    if (!target.label || !sourceValue.trim() || !ruleScopeValue.trim()) return null
    return {
      type: 'CREATE_SCOPED_RULE',
      field: actionField,
      sourceValue: sourceValue.trim(),
      value: target,
      scope: { [ruleScopeDimension]: [ruleScopeValue.trim()] },
      explanation,
    }
  }, [
    actionField,
    actionKind,
    effectiveQueuedChanges,
    explanation,
    ruleScopeDimension,
    ruleScopeValue,
    sourceValue,
    targetId,
    targetLabel,
  ])

  const rawSourceValue = detail?.evaluated.rawValues?.[actionField] ?? null
  const selectedIdentityId =
    identityChoice ||
    detail?.identityReview?.selectedCanonicalDeviceId ||
    detail?.identityReview?.candidates[0]?.canonicalDeviceId ||
    ''
  const identityPreviewCandidate =
    detail && identityPreview?.decision.canonicalDeviceId
      ? detail.identityReview?.candidates.find(
          (candidate) =>
            candidate.canonicalDeviceId === identityPreview.decision.canonicalDeviceId,
        ) ?? null
      : null
  const resolvedIdentityCandidate =
    detail?.identityReview?.selectedCanonicalDeviceId
      ? detail.identityReview.candidates.find(
          (candidate) =>
            candidate.canonicalDeviceId ===
            detail.identityReview?.selectedCanonicalDeviceId,
        ) ?? null
      : null

  const queueAnotherField = () => {
    if (!draftChange) return
    setQueuedChanges((current) => [
      ...current.filter((change) => change.field !== draftChange.field),
      draftChange,
    ])
    setTargetLabel('')
    setTargetId('')
    setPreview(null)
    setPreviewAction(null)
  }

  const requestPreview = async () => {
    if (!selection || !action) return
    setActionBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'PREVIEW', selection, action }),
      })
      const next = await responseData<ActionPreview>(response)
      setPreview(next)
      setPreviewAction(action)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to preview action.')
    } finally {
      setActionBusy(false)
    }
  }

  const applyPreview = async () => {
    if (!selection || !preview || !previewAction) return
    setActionBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'APPLY',
          selection,
          action: previewAction,
          scopeToken: preview.scopeToken,
        }),
      })
      const result = await responseData<{ affectedRowCount: number }>(response)
      setActionMessage(`Applied ${previewAction.type === 'CHANGE_SET' ? `${previewAction.changes.length} changes` : 'change'} to ${result.affectedRowCount.toLocaleString()} staged row${result.affectedRowCount === 1 ? '' : 's'}.`)
      if (previewAction.type === 'CHANGE_SET') setQueuedChanges([])
      setTargetLabel('')
      setTargetId('')
      setPreview(null)
      setPreviewAction(null)
      onRefresh()
    } catch (error) {
      setPreview(null)
      setPreviewAction(null)
      setActionMessage(error instanceof Error ? error.message : 'Unable to apply action.')
    } finally {
      setActionBusy(false)
    }
  }

  const requestIdentityPreview = async (decision: IdentityDecision) => {
    if (!detail) return
    setIdentityBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/rows/${detail.rowNumber}/identity`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'PREVIEW', decision }),
        },
      )
      const next = await responseData<IdentityPreview>(response)
      setIdentityPreview(next)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to preview identity decision.')
    } finally {
      setIdentityBusy(false)
    }
  }

  const applyIdentityPreview = async () => {
    if (!detail || !identityPreview) return
    setIdentityBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/rows/${detail.rowNumber}/identity`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'APPLY',
            decision: identityPreview.decision,
            scopeToken: identityPreview.scopeToken,
          }),
        },
      )
      await responseData(response)
      setIdentityPreview(null)
      setActionMessage('Identity decision confirmed.')
      onRefresh()
    } catch (error) {
      setIdentityPreview(null)
      setActionMessage(error instanceof Error ? error.message : 'Unable to confirm identity decision.')
    } finally {
      setIdentityBusy(false)
    }
  }

  const previewPriorityFields = previewAction
    ? previewAction.type === 'CHANGE_SET'
      ? previewAction.changes.map((change) => change.field)
      : 'field' in previewAction
        ? [previewAction.field]
        : []
    : []
  const prioritySet = new Set(previewPriorityFields)
  const commonValues = preview
    ? [
        ...previewPriorityFields.map((field) => [field, preview.commonValues[field]] as const),
        ...CLIENT_FIELDS.filter((field) => !prioritySet.has(field)).map(
          (field) => [field, preview.commonValues[field]] as const,
        ),
      ]
        .filter(([, value]) => value !== undefined && value !== null)
        .slice(0, 10)
    : []

  return (
    <aside
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      aria-label="Reconciliation inspector"
    >
      <div className="shrink-0 border-b border-[var(--border)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Inspector</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{selectionLabel}</p>
          </div>
          {detail ? (
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              #{detail.rowNumber}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-1">
          {(['REVIEW', 'EVIDENCE', 'HISTORY'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={[
                'rounded px-2 py-1.5 text-xs font-semibold',
                tab === value
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-light)]'
                  : 'text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]',
              ].join(' ')}
            >
              {value.charAt(0) + value.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div data-inspector-body className="noc-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {detailLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading staged row evidence…</p>
        ) : null}

        {tab === 'REVIEW' ? (
          <div className="space-y-3">
            {detail ? <StatusReason detail={detail} /> : null}

            {detail?.evaluated.issues?.length ? (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Active findings</h3>
                <div className="mt-2 space-y-2">
                  {detail.evaluated.issues.map((issue, index) => (
                    <div key={`${issue.field}-${index}`} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className={issue.severity === 'ERROR' ? 'font-semibold text-[#f0a0a0]' : 'font-semibold text-[var(--accent-light)]'}>
                          {issue.severity} · {fieldLabel(issue.field ?? 'row')}
                        </span>
                        {issue.field && CLIENT_FIELDS.includes(issue.field as ImporterV2Field) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActionKind('SET_FIELD')
                              setActionField(issue.field as ImporterV2Field)
                              setTargetLabel('')
                            }}
                            className="text-[var(--accent-light)] hover:underline"
                          >
                            Correct
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-1 leading-5 text-[var(--muted-strong)]">{issue.message}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : detail ? (
              <p className="text-xs text-[var(--muted)]">No active field errors or warnings.</p>
            ) : null}

            {detail?.canonicalHierarchy && <section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Canonical customer hierarchy</h3><p className="mt-1 text-xs text-[var(--muted)]">{detail.canonicalHierarchy.ready ? 'Hierarchy resolved for publication review.' : 'Hierarchy needs review before publication.'}</p>{(['customer', 'organizationUnit', 'site'] as const).map(key => <div key={key} className="mt-3 text-xs"><strong>{key === 'organizationUnit' ? 'Business unit' : key === 'customer' ? 'Customer' : 'Site'}: {detail.canonicalHierarchy![key].label ?? 'Ungrouped'}</strong><p className="mt-1 text-[var(--muted)]">{detail.canonicalHierarchy![key].reason}</p></div>)}</section>}
            {detail?.identityReview ? (
              <section className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-[var(--foreground)]">Existing device match</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
                      Decide whether this imported row is an existing device or a new device. Serial, MAC and source ID are durable identity evidence; hostname is supporting context only.
                    </p>
                    {detail.identityReview.explanation ? (
                      <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
                        {detail.identityReview.explanation}
                      </p>
                    ) : null}
                  </div>
                  <span className={detail.identityReview.requiresConfirmation ? 'shrink-0 text-right text-[10px] font-semibold uppercase text-[var(--accent-light)]' : 'shrink-0 text-right text-[10px] font-semibold uppercase text-[var(--muted)]'}>
                    {detail.identityReview.requiresConfirmation ? 'Confirmation required' : detail.identityReview.resolved ? 'Confirmed' : 'No action required'}
                  </span>
                </div>

                {detail.identityReview.resolved ? (
                  <div className="mt-2 rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-2 text-xs text-[var(--muted-strong)]">
                    <span className="font-semibold text-[var(--foreground)]">
                      {detail.identityReview.selectedDecision?.replaceAll('_', ' ')}
                    </span>
                    {detail && resolvedIdentityCandidate ? (
                      <span className="mt-1 block">{candidateTitle(detail, resolvedIdentityCandidate)}</span>
                    ) : null}
                    {detail.identityReview.selectedCanonicalDeviceId ? (
                      <span className="mt-1 block font-mono text-[9px] text-[var(--muted)]">
                        Internal device ID: {detail.identityReview.selectedCanonicalDeviceId}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {detail.identityReview.requiresConfirmation ? (
                  <div className="mt-3 space-y-2">
                    {detail.identityReview.candidates.map((candidate) => {
                      const location = candidateLocation(detail, candidate)
                      const visibleSignals = candidate.signals.filter(
                        (signal) => signal.status !== 'MISSING',
                      )
                      return (
                        <label key={candidate.canonicalDeviceId} className="flex cursor-pointer gap-2 rounded border border-[var(--border)] p-2 text-xs">
                          <input
                            className="mt-1 shrink-0"
                            type="radio"
                            name={`identity-${detail.rowNumber}`}
                            value={candidate.canonicalDeviceId}
                            checked={selectedIdentityId === candidate.canonicalDeviceId}
                            onChange={() => setIdentityChoice(candidate.canonicalDeviceId)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-start justify-between gap-2">
                              <span className="min-w-0">
                                <strong className="block truncate text-[var(--foreground)]">
                                  {candidateTitle(detail, candidate)}
                                </strong>
                                {location ? (
                                  <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                                    {location}
                                  </span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-[var(--accent-light)]">{candidate.confidence ?? '—'}</span>
                            </span>
                            <span className="mt-1 block leading-4 text-[var(--muted-strong)]">{candidate.explanation ?? 'Durable identity candidate.'}</span>
                            {visibleSignals.length ? (
                              <span className="mt-2 grid gap-1">
                                {visibleSignals.map((signal) => (
                                  <span key={signal.kind} className="grid grid-cols-[68px_minmax(0,1fr)_auto] gap-2 text-[10px]">
                                    <span className="text-[var(--muted)]">{identitySignalLabel(signal.kind)}</span>
                                    <span className="truncate font-mono text-[var(--muted-strong)]">{display(signal.candidateValue)}</span>
                                    <span className={signal.status === 'AGREE' ? 'font-semibold text-[var(--muted-strong)]' : 'font-semibold text-[#f0a0a0]'}>
                                      {identitySignalState(signal.status)}
                                    </span>
                                  </span>
                                ))}
                              </span>
                            ) : candidate.durableEvidence.length ? (
                              <span className="mt-1 block text-[10px] text-[var(--muted)]">Durable evidence: {candidate.durableEvidence.map(identitySignalLabel).join(', ')}</span>
                            ) : null}
                            <span className="mt-2 block truncate font-mono text-[9px] text-[var(--muted)]">
                              Internal device ID: {candidate.canonicalDeviceId}
                            </span>
                          </span>
                        </label>
                      )
                    })}

                    {identityPreview ? (
                      <div className="rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-2 text-xs">
                        <p className="font-semibold text-[var(--foreground)]">Identity decision preview</p>
                        <p className="mt-1 text-[var(--muted-strong)]">
                          {identityPreview.decision.kind === 'CREATE_NEW'
                            ? 'Create this imported row as a new device.'
                            : identityPreviewCandidate && detail
                              ? `Use existing device: ${candidateTitle(detail, identityPreviewCandidate)}.`
                              : identityPreview.decision.canonicalDeviceId
                                ? `Use device ID ${identityPreview.decision.canonicalDeviceId}.`
                                : identityPreview.decision.kind.replaceAll('_', ' ')}
                        </p>
                        {identityPreview.decision.canonicalDeviceId ? (
                          <p className="mt-1 font-mono text-[9px] text-[var(--muted)]">
                            Internal device ID: {identityPreview.decision.canonicalDeviceId}
                          </p>
                        ) : null}
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Button variant="ghost" onClick={() => setIdentityPreview(null)}>Edit</Button>
                          <Button variant="primary" disabled={identityBusy} onClick={() => void applyIdentityPreview()}>Confirm identity</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="min-w-0 whitespace-normal px-2 text-center leading-tight"
                          variant="secondary"
                          disabled={identityBusy || !selectedIdentityId}
                          onClick={() => void requestIdentityPreview({
                            kind: detail.identityReview!.candidates.length === 1 ? 'CONFIRM_MATCH' : 'CHOOSE_CANDIDATE',
                            canonicalDeviceId: selectedIdentityId,
                            explanation: identityExplanation,
                          })}
                        >
                          Use existing device
                        </Button>
                        <Button
                          className="min-w-0 whitespace-normal px-2 text-center leading-tight"
                          variant="secondary"
                          disabled={identityBusy}
                          onClick={() => void requestIdentityPreview({
                            kind: 'CREATE_NEW',
                            canonicalDeviceId: null,
                            explanation: identityExplanation,
                          })}
                        >
                          Create new device
                        </Button>
                      </div>
                    )}

                    <TextInput
                      aria-label="Identity decision explanation"
                      value={identityExplanation}
                      onChange={(event) => setIdentityExplanation(event.target.value)}
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <TextInput
                        aria-label="Manual canonical device ID"
                        placeholder="Canonical device ID override"
                        value={identityManualId}
                        onChange={(event) => setIdentityManualId(event.target.value)}
                      />
                      <Button
                        className="whitespace-nowrap"
                        variant="ghost"
                        disabled={identityBusy || !identityManualId.trim()}
                        onClick={() => void requestIdentityPreview({
                          kind: 'MANUAL_OVERRIDE',
                          canonicalDeviceId: identityManualId.trim(),
                          explanation: identityExplanation,
                        })}
                      >
                        Use device ID
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'EVIDENCE' ? (
          detail ? (
            <div className="space-y-4">
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Raw source evidence</h3>
                <dl className="mt-2 space-y-1.5">
                  {CLIENT_FIELDS.map((field) => (
                    <div key={field} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-xs">
                      <dt className="text-[var(--muted)]">{fieldLabel(field)}</dt>
                      <dd className="break-words font-mono text-[var(--muted-strong)]">{display(detail.evaluated.rawValues?.[field])}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Proposals and proof</h3>
                <div className="mt-2 space-y-2">
                  {CLIENT_FIELDS.map((field) => {
                    const evaluatedField = detail.evaluated.fields?.[field]
                    if (!evaluatedField?.proposedValue && !evaluatedField?.decision) return null
                    return (
                      <div key={field} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs">
                        <div className="flex justify-between gap-2">
                          <strong className="text-[var(--foreground)]">{fieldLabel(field)}</strong>
                          <span className="text-[var(--accent-light)]">{evaluatedField.proposedValue?.label ?? 'Unresolved'}</span>
                        </div>
                        <p className="mt-1 text-[var(--muted)]">{evaluatedField.decision?.source ?? 'UNRESOLVED'} · {evaluatedField.decision?.confidence ?? '—'}</p>
                        <p className="mt-1 leading-5 text-[var(--muted-strong)]">{evaluatedField.decision?.explanation ?? 'No decision explanation available.'}</p>
                        {evaluatedField.decision?.matchedRuleId || evaluatedField.decision?.matchedParserId ? (
                          <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                            Rule {evaluatedField.decision?.matchedRuleId ?? '—'} v{evaluatedField.decision?.matchedRuleVersion ?? '—'} · Parser {evaluatedField.decision?.matchedParserId ?? '—'} v{evaluatedField.decision?.matchedParserVersion ?? '—'}
                          </p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>

              {detail.identityReview?.candidates.length ? (
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Identity evidence</h3>
                  <div className="mt-2 space-y-2">
                    {detail.identityReview.candidates.map((candidate) => (
                      <div key={candidate.canonicalDeviceId} className="rounded border border-[var(--border)] p-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <strong className="block truncate">{candidateTitle(detail, candidate)}</strong>
                            {candidateLocation(detail, candidate) ? (
                              <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{candidateLocation(detail, candidate)}</span>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[var(--accent-light)]">{candidate.confidence ?? '—'}</span>
                        </div>
                        <p className="mt-1 text-[var(--muted-strong)]">{candidate.explanation ?? 'No explanation.'}</p>
                        {candidate.signals.length ? (
                          <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                            {candidate.signals.map((signal) => (
                              <p key={signal.kind} className="grid grid-cols-[80px_minmax(0,1fr)_auto] gap-2 text-[10px]">
                                <span className="text-[var(--muted)]">{identitySignalLabel(signal.kind)}</span>
                                <span className="font-mono text-[var(--muted-strong)]">{display(signal.candidateValue)}</span>
                                <span className={signal.status === 'AGREE' ? 'font-semibold text-[var(--muted-strong)]' : 'font-semibold text-[#f0a0a0]'}>{identitySignalState(signal.status)}</span>
                              </p>
                            ))}
                          </div>
                        ) : candidate.durableEvidence.length ? <p className="mt-1 text-[10px] text-[var(--muted)]">Durable evidence: {candidate.durableEvidence.map(identitySignalLabel).join(', ')}</p> : null}
                        {candidate.contextDifferences.length ? (
                          <div className="mt-2 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted)]">
                            {candidate.contextDifferences.map((difference) => (
                              <p key={difference.field}>{fieldLabel(difference.field)}: {display(difference.sourceValue)} → {display(difference.candidateValue)}</p>
                            ))}
                          </div>
                        ) : null}
                        <p className="mt-2 truncate font-mono text-[9px] text-[var(--muted)]">Internal device ID: {candidate.canonicalDeviceId}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {detail.alternatives ? (
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Alternative suggestions</h3>
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[10px] leading-4 text-[var(--muted-strong)]">{JSON.stringify(detail.alternatives, null, 2)}</pre>
                </section>
              ) : null}
            </div>
          ) : <p className="text-sm text-[var(--muted)]">Select one row to inspect evidence.</p>
        ) : null}

        {tab === 'HISTORY' ? (
          detail ? (
            <div className="space-y-4">
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Repeat-import difference</h3>
                {detail.repeatDiff ? (
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[10px] leading-4 text-[var(--muted-strong)]">{JSON.stringify(detail.repeatDiff, null, 2)}</pre>
                ) : <p className="mt-2 text-xs text-[var(--muted)]">No repeat-import difference recorded.</p>}
              </section>
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Review decisions</h3>
                {detail.decisions?.length ? (
                  <div className="mt-2 space-y-2">
                    {detail.decisions.map((decision) => (
                      <div key={decision.id} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs">
                        <div className="flex justify-between gap-2">
                          <strong className="text-[var(--foreground)]">{decision.action.replaceAll('_', ' ')}{decision.field ? ` · ${fieldLabel(decision.field)}` : ''}</strong>
                          <span className="text-[10px] text-[var(--muted)]">{new Date(decision.createdAt).toLocaleString()}</span>
                        </div>
                        {decisionValue(decision.value) ? <p className="mt-1 font-mono text-[10px] text-[var(--accent-light)]">{decisionValue(decision.value)}</p> : null}
                        <p className="mt-1 text-[var(--muted-strong)]">{decision.explanation}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-2 text-xs text-[var(--muted)]">No engineer review decisions yet.</p>}
              </section>
            </div>
          ) : <p className="text-sm text-[var(--muted)]">Select one row to inspect history.</p>
        ) : null}
      </div>

      {selection && tab === 'REVIEW' ? (
        <div data-inspector-footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] p-3">
          {preview && previewAction ? (
            <div className="space-y-2 rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Review {previewAction.type === 'CHANGE_SET' ? `${previewAction.changes.length} changes` : 'change'} · {preview.affectedRowCount.toLocaleString()} rows</p>
                  {preview.confirmationReasons.map((reason) => <p key={reason} className="mt-1 text-[var(--muted-strong)]">{reason}</p>)}
                </div>
                <Button variant="ghost" onClick={() => { setPreview(null); setPreviewAction(null) }}>Edit</Button>
              </div>
              {commonValues.length ? (
                <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-2">
                  {commonValues.map(([field, value]) => (
                    <div key={field} className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
                      <span className="text-[var(--muted)]">{fieldLabel(field)}</span>
                      <span className={value === 'MIXED' ? 'font-semibold text-[var(--accent-light)]' : 'truncate text-[var(--muted-strong)]'}>{value === 'MIXED' ? 'Different values' : display(value)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button variant="primary" className="w-full" disabled={actionBusy} onClick={() => void applyPreview()}>
                Confirm and apply to {preview.affectedRowCount.toLocaleString()}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Reconcile selection</h3>
                <span className="text-[10px] text-[var(--muted)]">{selectionLabel}</span>
              </div>
              <SelectInput aria-label="Reconciliation action" value={actionKind} onChange={(event) => { setActionKind(event.target.value as ActionKind); setPreview(null); setPreviewAction(null) }}>
                {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectInput>

              {actionKind === 'CHANGE_SET' ? (
                <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <SelectInput aria-label="Pending change operation" value={changeSetOperation} onChange={(event) => setChangeSetOperation(event.target.value as ChangeSetOperation)}>
                      <option value="SET_FIELD">Set field</option>
                      <option value="LINK_FIELD">Link canonical value</option>
                      <option value="CLEAR_FIELD">Clear field</option>
                      <option value="IGNORE_FIELD">Ignore source field</option>
                    </SelectInput>
                    <SelectInput aria-label="Pending change field" value={actionField} onChange={(event) => setActionField(event.target.value as ImporterV2Field)}>
                      {CLIENT_FIELDS.map((field) => <option key={field} value={field}>{fieldLabel(field)}</option>)}
                    </SelectInput>
                  </div>
                  {changeSetOperation === 'SET_FIELD' || changeSetOperation === 'LINK_FIELD' ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
                      <TextInput aria-label="Pending target label" placeholder="Target label" value={targetLabel} onChange={(event) => setTargetLabel(event.target.value)} />
                      <TextInput aria-label="Pending target ID" placeholder="ID" value={targetId} onChange={(event) => setTargetId(event.target.value)} />
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[var(--muted)]">The current field is automatically included when you review.</span>
                    <Button variant="ghost" disabled={!draftChange} onClick={queueAnotherField}>+ Add another field</Button>
                  </div>
                  {effectiveQueuedChanges.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {effectiveQueuedChanges.map((change) => (
                        <span key={change.field} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-strong)]">
                          {fieldLabel(change.field)} · {changeSetOperationLabel(change.type)}{'value' in change ? ` → ${change.value.label}` : ''}
                          <button type="button" className="text-[var(--accent-light)]" onClick={() => setQueuedChanges((current) => current.filter((item) => item.field !== change.field))}>×</button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : actionKind !== 'EXCLUDE_ROW' ? (
                <SelectInput aria-label="Field to reconcile" value={actionField} onChange={(event) => setActionField(event.target.value as ImporterV2Field)}>
                  {CLIENT_FIELDS.map((field) => <option key={field} value={field}>{fieldLabel(field)}</option>)}
                </SelectInput>
              ) : null}

              {['SET_FIELD', 'LINK_FIELD', 'REMEMBER_EXACT', 'CREATE_SCOPED_RULE'].includes(actionKind) ? (
                <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
                  <TextInput aria-label="Target label" placeholder="Target label" value={targetLabel} onChange={(event) => setTargetLabel(event.target.value)} />
                  <TextInput aria-label="Canonical target ID" placeholder="ID" value={targetId} onChange={(event) => setTargetId(event.target.value)} />
                </div>
              ) : null}

              {actionKind === 'REMEMBER_EXACT' || actionKind === 'CREATE_SCOPED_RULE' ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <TextInput aria-label="Exact source value" placeholder="Exact source value" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} />
                  {rawSourceValue ? <Button variant="ghost" onClick={() => setSourceValue(rawSourceValue)}>Use raw</Button> : null}
                </div>
              ) : null}

              {actionKind === 'CREATE_SCOPED_RULE' ? (
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                  <SelectInput aria-label="Rule scope dimension" value={ruleScopeDimension} onChange={(event) => setRuleScopeDimension(event.target.value as RuleScopeDimension)}>
                    <option value="customer">Customer</option><option value="businessUnit">Subdomain</option><option value="site">Site</option><option value="vendor">Vendor</option><option value="model">Model</option><option value="productFamily">Product family</option><option value="deviceType">Device type</option>
                  </SelectInput>
                  <TextInput aria-label="Rule scope value" placeholder="Exact scope value" value={ruleScopeValue} onChange={(event) => setRuleScopeValue(event.target.value)} />
                </div>
              ) : null}

              <TextInput aria-label="Decision explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} />
              <Button variant="primary" className="w-full" disabled={!action || actionBusy} onClick={() => void requestPreview()}>
                {actionKind === 'CHANGE_SET' ? `Review ${effectiveQueuedChanges.length} change${effectiveQueuedChanges.length === 1 ? '' : 's'}` : 'Preview exact scope'}
              </Button>
            </div>
          )}
          {actionMessage ? <p role="status" className="mt-2 text-xs leading-5 text-[var(--accent-light)]">{actionMessage}</p> : null}
        </div>
      ) : null}
    </aside>
  )
}
