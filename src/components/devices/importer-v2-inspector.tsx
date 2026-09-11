'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import type {
  ImporterV2WorkspaceAction,
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

type InspectorTab = 'REVIEW' | 'EVIDENCE' | 'HISTORY'
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
type CanonicalChoice = {
  id: string
  label: string
  description: string | null
  exactSourceMatch: boolean
}
type CanonicalChoiceResult = {
  field: ImporterV2Field
  sourceValue: string | null
  currentValue: { id: string | null; label: string } | null
  searchable: boolean
  choices: CanonicalChoice[]
}
type GuidedRulePreview = {
  scopeToken: string
  preview: {
    matchedRowCount: number
    changedFields: ImporterV2Field[]
    conflicts: Array<{ explanation: string }>
    examples: Array<{
      rowNumber: number
      before: Partial<Record<ImporterV2Field, string | null>>
      after: Partial<Record<ImporterV2Field, string | null>>
    }>
    confirmationReasons: string[]
  }
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

function suggestedRuleMatchField(
  actionField: ImporterV2Field,
  detail: RowDetail | null,
): ImporterV2Field {
  const raw = detail?.evaluated.rawValues
  if (raw?.[actionField]) return actionField
  if (
    (actionField === 'vendor' ||
      actionField === 'productFamily' ||
      actionField === 'softwarePlatform' ||
      actionField === 'deviceType') &&
    raw?.model
  ) {
    return 'model'
  }
  if (actionField === 'currentFirmware') {
    if (raw?.softwareVersion) return 'softwareVersion'
    if (raw?.firmwareVersion) return 'firmwareVersion'
  }
  return actionField
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
  if (status === 'AGREE') return 'MATCH'
  if (status === 'DISAGREE') return 'DIFFERENT'
  if (status === 'MISSING') return 'MISSING'
  return status ?? '—'
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
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
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
  const [actionField, setActionField] = useState<ImporterV2Field>('model')
  const [targetLabel, setTargetLabel] = useState('')
  const [targetId, setTargetId] = useState('')
  const [rememberExact, setRememberExact] = useState(false)
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [previewAction, setPreviewAction] = useState<ImporterV2WorkspaceAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [choiceQuery, setChoiceQuery] = useState('')
  const [choiceResult, setChoiceResult] = useState<CanonicalChoiceResult | null>(null)
  const [choiceBusy, setChoiceBusy] = useState(false)
  const [identityChoice, setIdentityChoice] = useState('')
  const [identityPreview, setIdentityPreview] = useState<IdentityPreview | null>(null)
  const [identityBusy, setIdentityBusy] = useState(false)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [ruleMatchField, setRuleMatchField] = useState<ImporterV2Field>('model')
  const [ruleOperator, setRuleOperator] = useState<
    'NORMALIZED_EXACT' | 'PREFIX' | 'CONTAINS' | 'PATTERN' | 'VERSION_MATCH'
  >('NORMALIZED_EXACT')
  const [ruleMatch, setRuleMatch] = useState('')
  const [ruleScope, setRuleScope] = useState<'PROFILE' | 'CUSTOMER' | 'VENDOR' | 'MODEL'>('PROFILE')
  const [rulePreview, setRulePreview] = useState<GuidedRulePreview | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)

  const rawSourceValue = detail?.evaluated.rawValues?.[actionField] ?? null
  const ruleSourceValue = detail?.evaluated.rawValues?.[ruleMatchField] ?? null
  const proposedValue = detail?.evaluated.fields?.[actionField]?.proposedValue ?? null
  const selectedIdentityId =
    identityChoice ||
    detail?.identityReview?.selectedCanonicalDeviceId ||
    detail?.identityReview?.candidates[0]?.canonicalDeviceId ||
    ''

  const action = useMemo<ImporterV2WorkspaceAction | null>(() => {
    const label = targetLabel.trim()
    if (!label) return null
    const value = { id: targetId.trim() || null, label }
    if (rememberExact && rawSourceValue?.trim()) {
      return {
        type: 'REMEMBER_EXACT',
        field: actionField,
        normalizedInput: rawSourceValue.trim(),
        value,
        explanation: 'Confirmed exact source mapping from the importer inspector.',
      }
    }
    return {
      type: value.id ? 'LINK_FIELD' : 'SET_FIELD',
      field: actionField,
      value,
      explanation: value.id
        ? 'Linked the imported value to an existing canonical record.'
        : 'Set the staged canonical value from the importer inspector.',
    }
  }, [actionField, rawSourceValue, rememberExact, targetId, targetLabel])

  const setEditorField = (field: ImporterV2Field) => {
    setActionField(field)
    setPreview(null)
    setPreviewAction(null)
    setChoiceResult(null)
    setChoiceQuery('')
    setTargetId('')
    const suggested = detail?.evaluated.fields?.[field]?.proposedValue?.label
    const raw = detail?.evaluated.rawValues?.[field]
    setTargetLabel(suggested ?? raw ?? '')
    setRuleOpen(false)
    setRulePreview(null)
  }

  const searchChoices = async () => {
    if (!detail) return
    setChoiceBusy(true)
    setActionMessage(null)
    try {
      const params = new URLSearchParams({ field: actionField })
      if (choiceQuery.trim()) params.set('q', choiceQuery.trim())
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/rows/${detail.rowNumber}/choices?${params}`,
        { cache: 'no-store' },
      )
      setChoiceResult(await responseData<CanonicalChoiceResult>(response))
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to load canonical choices.',
      )
    } finally {
      setChoiceBusy(false)
    }
  }

  const requestPreview = async (nextAction: ImporterV2WorkspaceAction | null = action) => {
    if (!selection || !nextAction) return
    setActionBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'PREVIEW', selection, action: nextAction }),
      })
      const next = await responseData<ActionPreview>(response)
      setPreview(next)
      setPreviewAction(nextAction)
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to preview change.',
      )
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
      setActionMessage(
        `Applied to ${result.affectedRowCount.toLocaleString()} staged row${result.affectedRowCount === 1 ? '' : 's'}.`,
      )
      setPreview(null)
      setPreviewAction(null)
      setTargetId('')
      setTargetLabel('')
      setChoiceResult(null)
      onRefresh()
    } catch (error) {
      setPreview(null)
      setPreviewAction(null)
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to apply change.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  const previewClear = () => {
    void requestPreview({
      type: 'CLEAR_FIELD',
      field: actionField,
      explanation: 'Cleared this staged field from the importer inspector.',
    })
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
      setIdentityPreview(await responseData<IdentityPreview>(response))
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to preview identity decision.',
      )
    } finally {
      setIdentityBusy(false)
    }
  }

  const applyIdentityPreview = async () => {
    if (!detail || !identityPreview) return
    setIdentityBusy(true)
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
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to confirm identity decision.',
      )
    } finally {
      setIdentityBusy(false)
    }
  }

  const openRuleWizard = () => {
    const matchField = suggestedRuleMatchField(actionField, detail)
    setRuleMatchField(matchField)
    setRuleOpen(true)
    setRulePreview(null)
    setRuleMatch(detail?.evaluated.rawValues?.[matchField] ?? '')
  }

  const wizardPayload = () => {
    if (!detail || !targetLabel.trim()) return null
    return {
      rowNumber: detail.rowNumber,
      field: actionField,
      matchField: ruleMatchField,
      operator: ruleOperator,
      matchValue: ruleMatch.trim(),
      target: { id: targetId.trim() || null, label: targetLabel.trim() },
      scope: ruleScope,
      explanation: 'Created from the guided importer automation wizard.',
    }
  }

  const requestRulePreview = async () => {
    const wizard = wizardPayload()
    if (!wizard || !wizard.matchValue) return
    setRuleBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'PREVIEW', wizard }),
      })
      setRulePreview(await responseData<GuidedRulePreview>(response))
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to preview automation.',
      )
    } finally {
      setRuleBusy(false)
    }
  }

  const applyRulePreview = async () => {
    const wizard = wizardPayload()
    if (!wizard || !rulePreview) return
    setRuleBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'APPLY',
          wizard,
          scopeToken: rulePreview.scopeToken,
        }),
      })
      const result = await responseData<{
        automation: { automaticDecisionsApplied: number }
      }>(response)
      setRulePreview(null)
      setRuleOpen(false)
      setActionMessage(
        `Automation activated. ${result.automation.automaticDecisionsApplied.toLocaleString()} new staged decision${result.automation.automaticDecisionsApplied === 1 ? '' : 's'} applied.`,
      )
      onRefresh()
    } catch (error) {
      setRulePreview(null)
      setActionMessage(
        error instanceof Error ? error.message : 'Unable to activate automation.',
      )
    } finally {
      setRuleBusy(false)
    }
  }

  const commonValues = preview
    ? Object.entries(preview.commonValues)
        .filter(([, value]) => value !== undefined && value !== null)
        .slice(0, 8)
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
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    What needs attention
                  </h3>
                  <span className="text-[10px] text-[var(--muted)]">Click a finding to fix it</span>
                </div>
                <div className="mt-2 space-y-2">
                  {detail.evaluated.issues.map((issue, index) => {
                    const field = issue.field as ImporterV2Field | undefined
                    return (
                      <button
                        key={`${issue.field}-${index}`}
                        type="button"
                        disabled={!field || !CLIENT_FIELDS.includes(field)}
                        onClick={() => field && setEditorField(field)}
                        className="w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-left text-xs transition hover:border-[var(--accent-muted)] hover:bg-[var(--surface-muted)] disabled:cursor-default"
                      >
                        <span
                          className={
                            issue.severity === 'ERROR'
                              ? 'font-semibold text-[#f0a0a0]'
                              : 'font-semibold text-[var(--accent-light)]'
                          }
                        >
                          {issue.severity} · {fieldLabel(issue.field ?? 'row')}
                        </span>
                        <span className="mt-1 block leading-5 text-[var(--muted-strong)]">
                          {issue.message}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : detail ? (
              <p className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--muted)]">
                No active field errors or warnings. If identity is also resolved, this row is ready for Final QA.
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">Select one row to review its exceptions.</p>
            )}

            {detail?.canonicalHierarchy ? (
              <section className="rounded-md border border-[var(--border)] p-3">
                <h3 className="text-sm font-semibold">Canonical customer hierarchy</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {detail.canonicalHierarchy.ready
                    ? 'Hierarchy resolved for publication review.'
                    : 'Hierarchy needs review before publication.'}
                </p>
                {(['customer', 'organizationUnit', 'site'] as const).map((key) => (
                  <div key={key} className="mt-3 text-xs">
                    <strong>
                      {key === 'organizationUnit'
                        ? 'Subdomain'
                        : key === 'customer'
                          ? 'Customer'
                          : 'Site'}
                      : {detail.canonicalHierarchy?.[key].label ?? 'Ungrouped'}
                    </strong>
                    <p className="mt-1 text-[var(--muted)]">
                      {detail.canonicalHierarchy?.[key].reason}
                    </p>
                  </div>
                ))}
              </section>
            ) : null}

            {detail?.identityReview?.requiresConfirmation ? (
              <section className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <h3 className="text-xs font-semibold text-[var(--foreground)]">Device identity</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
                  Only ambiguous or lower-confidence identity needs manual input. Serial, MAC and source ID are the durable evidence.
                </p>
                <div className="mt-3 space-y-2">
                  {detail.identityReview.candidates.map((candidate) => (
                    <label
                      key={candidate.canonicalDeviceId}
                      className="flex cursor-pointer gap-2 rounded border border-[var(--border)] p-2 text-xs"
                    >
                      <input
                        type="radio"
                        name={`identity-${detail.rowNumber}`}
                        checked={selectedIdentityId === candidate.canonicalDeviceId}
                        onChange={() => setIdentityChoice(candidate.canonicalDeviceId)}
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[var(--foreground)]">
                          {candidateTitle(detail, candidate)}
                        </strong>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                          {candidateLocation(detail, candidate)}
                        </span>
                        <span className="mt-1 block text-[var(--muted-strong)]">
                          {candidate.explanation ?? 'Durable identity candidate.'}
                        </span>
                      </span>
                      <span className="text-[var(--accent-light)]">{candidate.confidence ?? '—'}</span>
                    </label>
                  ))}
                </div>

                {identityPreview ? (
                  <div className="mt-3 rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-2 text-xs">
                    <p className="font-semibold">Identity decision ready</p>
                    <p className="mt-1 text-[var(--muted-strong)]">
                      {identityPreview.decision.kind === 'CREATE_NEW'
                        ? 'Create this as a new device.'
                        : `Use canonical device ${identityPreview.decision.canonicalDeviceId}.`}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button variant="ghost" onClick={() => setIdentityPreview(null)}>
                        Edit
                      </Button>
                      <Button variant="primary" disabled={identityBusy} onClick={() => void applyIdentityPreview()}>
                        Confirm identity
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      disabled={identityBusy || !selectedIdentityId}
                      onClick={() =>
                        void requestIdentityPreview({
                          kind:
                            detail.identityReview?.candidates.length === 1
                              ? 'CONFIRM_MATCH'
                              : 'CHOOSE_CANDIDATE',
                          canonicalDeviceId: selectedIdentityId,
                          explanation: 'Confirmed durable identity evidence.',
                        })
                      }
                    >
                      Use existing
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={identityBusy}
                      onClick={() =>
                        void requestIdentityPreview({
                          kind: 'CREATE_NEW',
                          canonicalDeviceId: null,
                          explanation: 'Confirmed this source row represents a new device.',
                        })
                      }
                    >
                      Create new
                    </Button>
                  </div>
                )}
              </section>
            ) : detail?.identityReview?.resolved ? (
              <section className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs">
                <strong>Device identity</strong>
                <p className="mt-1 text-[var(--muted-strong)]">
                  {detail.identityReview.selectedDecision?.replaceAll('_', ' ')} · no manual identity action required.
                </p>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'EVIDENCE' ? (
          detail ? (
            <div className="space-y-4">
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Proposals and proof
                </h3>
                <div className="mt-2 space-y-2">
                  {CLIENT_FIELDS.map((field) => {
                    const evaluatedField = detail.evaluated.fields?.[field]
                    const raw = detail.evaluated.rawValues?.[field]
                    if (!evaluatedField?.proposedValue && !evaluatedField?.decision && !raw) return null
                    return (
                      <div
                        key={field}
                        className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <strong className="text-[var(--foreground)]">{fieldLabel(field)}</strong>
                            <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                              Source: {display(raw)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditorField(field)}
                            className="text-[var(--accent-light)] hover:underline"
                          >
                            Use / change
                          </button>
                        </div>
                        <p className="mt-2 font-semibold text-[var(--accent-light)]">
                          Proposed: {evaluatedField?.proposedValue?.label ?? 'Unresolved'}
                        </p>
                        <p className="mt-1 text-[var(--muted)]">
                          {evaluatedField?.decision?.source ?? 'UNRESOLVED'} ·{' '}
                          {evaluatedField?.decision?.confidence ?? '—'}
                        </p>
                        <p className="mt-1 leading-5 text-[var(--muted-strong)]">
                          {evaluatedField?.decision?.explanation ?? 'No decision explanation available.'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </section>

              {detail.identityReview?.candidates.length ? (
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Identity evidence
                  </h3>
                  <div className="mt-2 space-y-2">
                    {detail.identityReview.candidates.map((candidate) => (
                      <div key={candidate.canonicalDeviceId} className="rounded border border-[var(--border)] p-2 text-xs">
                        <div className="flex justify-between gap-2">
                          <strong>{candidateTitle(detail, candidate)}</strong>
                          <span className="text-[var(--accent-light)]">{candidate.confidence ?? '—'}</span>
                        </div>
                        {candidate.signals.map((signal) => (
                          <p
                            key={signal.kind}
                            className="mt-1 grid grid-cols-[74px_minmax(0,1fr)_auto] gap-2 text-[10px]"
                          >
                            <span className="text-[var(--muted)]">{identitySignalLabel(signal.kind)}</span>
                            <span className="truncate font-mono text-[var(--muted-strong)]">
                              {display(signal.candidateValue)}
                            </span>
                            <span
                              className={
                                signal.status === 'AGREE'
                                  ? 'font-semibold text-[var(--muted-strong)]'
                                  : 'font-semibold text-[#f0a0a0]'
                              }
                            >
                              {identitySignalState(signal.status)}
                            </span>
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Select one row to inspect evidence.</p>
          )
        ) : null}

        {tab === 'HISTORY' ? (
          detail ? (
            <div className="space-y-4">
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Review decisions
                </h3>
                {detail.decisions?.length ? (
                  <div className="mt-2 space-y-2">
                    {detail.decisions.map((decision) => (
                      <div key={decision.id} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs">
                        <strong>
                          {decision.action.replaceAll('_', ' ')}
                          {decision.field ? ` · ${fieldLabel(decision.field)}` : ''}
                        </strong>
                        {decisionValue(decision.value) ? (
                          <p className="mt-1 font-mono text-[10px] text-[var(--accent-light)]">
                            {decisionValue(decision.value)}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[var(--muted-strong)]">{decision.explanation}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[var(--muted)]">No engineer decisions yet.</p>
                )}
              </section>
              {detail.repeatDiff ? (
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Repeat-import difference
                  </h3>
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[10px] leading-4 text-[var(--muted-strong)]">
                    {JSON.stringify(detail.repeatDiff, null, 2)}
                  </pre>
                </section>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Select one row to inspect history.</p>
          )
        ) : null}
      </div>

      {selection && tab === 'REVIEW' ? (
        <div data-inspector-footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] p-3">
          {preview && previewAction ? (
            <div className="space-y-2 rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">
                    Apply to {preview.affectedRowCount.toLocaleString()} row{preview.affectedRowCount === 1 ? '' : 's'}
                  </p>
                  {preview.confirmationReasons.map((reason) => (
                    <p key={reason} className="mt-1 text-[var(--muted-strong)]">
                      {reason}
                    </p>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPreview(null)
                    setPreviewAction(null)
                  }}
                >
                  Edit
                </Button>
              </div>
              {commonValues.length ? (
                <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-2">
                  {commonValues.map(([field, value]) => (
                    <div key={field} className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
                      <span className="text-[var(--muted)]">{fieldLabel(field)}</span>
                      <span className="truncate text-[var(--muted-strong)]">
                        {value === 'MIXED' ? 'Different values' : display(value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button variant="primary" className="w-full" disabled={actionBusy} onClick={() => void applyPreview()}>
                Confirm and apply
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Fix selected field</h3>
                <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
                  Set a value or clear it. Choosing an existing result automatically links it; you never need to type an internal ID.
                </p>
              </div>

              <SelectInput
                aria-label="Field to reconcile"
                value={actionField}
                onChange={(event) => setEditorField(event.target.value as ImporterV2Field)}
              >
                {CLIENT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {fieldLabel(field)}
                  </option>
                ))}
              </SelectInput>

              {detail ? (
                <div className="grid grid-cols-2 gap-2 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-[10px]">
                  <div>
                    <span className="text-[var(--muted)]">Source</span>
                    <p className="mt-0.5 break-words font-mono text-[var(--muted-strong)]">
                      {display(rawSourceValue)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Current proposal</span>
                    <p className="mt-0.5 break-words font-semibold text-[var(--accent-light)]">
                      {display(proposedValue?.label)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <TextInput
                  aria-label="Target value"
                  placeholder="Search or enter target value"
                  value={targetLabel}
                  onChange={(event) => {
                    setTargetLabel(event.target.value)
                    setTargetId('')
                    setPreview(null)
                  }}
                />
                {rawSourceValue ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setTargetLabel(rawSourceValue)
                      setTargetId('')
                    }}
                  >
                    Use source
                  </Button>
                ) : null}
              </div>

              {detail ? (
                <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <TextInput
                      aria-label="Search canonical values"
                      placeholder="Find existing canonical value…"
                      value={choiceQuery}
                      onChange={(event) => setChoiceQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void searchChoices()
                        }
                      }}
                    />
                    <Button variant="secondary" disabled={choiceBusy} onClick={() => void searchChoices()}>
                      {choiceBusy ? 'Searching…' : 'Find'}
                    </Button>
                  </div>
                  {choiceResult && !choiceResult.searchable ? (
                    <p className="text-[10px] text-[var(--muted)]">
                      This field is free text; use the source value or type the corrected value above.
                    </p>
                  ) : null}
                  {choiceResult?.choices.length ? (
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {choiceResult.choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => {
                            setTargetId(choice.id.startsWith('platform:') ? '' : choice.id)
                            setTargetLabel(choice.label)
                            setPreview(null)
                          }}
                          className="flex w-full items-start justify-between gap-2 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-left text-xs hover:border-[var(--accent-muted)]"
                        >
                          <span className="min-w-0">
                            <strong className="block truncate text-[var(--foreground)]">{choice.label}</strong>
                            {choice.description ? (
                              <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                                {choice.description}
                              </span>
                            ) : null}
                          </span>
                          {choice.exactSourceMatch ? (
                            <span className="shrink-0 text-[10px] font-semibold text-[var(--accent-light)]">EXACT</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : choiceResult?.searchable ? (
                    <p className="text-[10px] text-[var(--muted)]">
                      No existing canonical values matched. You can still use the typed value as a new catalog proposal.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {rawSourceValue ? (
                <label className="flex items-start gap-2 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs">
                  <input
                    className="mt-0.5"
                    type="checkbox"
                    checked={rememberExact}
                    onChange={(event) => setRememberExact(event.target.checked)}
                  />
                  <span>
                    <strong className="block text-[var(--foreground)]">Remember this exact source value</strong>
                    <span className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">
                      Reuse this mapping for every identical value in this batch and future imports from this source profile.
                    </span>
                  </span>
                </label>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={actionBusy} onClick={previewClear}>
                  Clear field
                </Button>
                <Button variant="primary" disabled={!action || actionBusy} onClick={() => void requestPreview()}>
                  Preview set value
                </Button>
              </div>

              {detail && targetLabel.trim() ? (
                <div className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                  <button
                    type="button"
                    onClick={ruleOpen ? () => setRuleOpen(false) : openRuleWizard}
                    className="flex w-full items-center justify-between text-left text-xs font-semibold text-[var(--accent-light)]"
                  >
                    <span>Create broader automation from this fix</span>
                    <span>{ruleOpen ? '−' : '+'}</span>
                  </button>

                  {ruleOpen ? (
                    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                      <p className="text-[10px] leading-4 text-[var(--muted)]">
                        Build a simple IF → THEN rule. Choose which source column contains the pattern; it does not have to be the field you are fixing.
                      </p>

                      <div className="rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[10px]">
                        <strong className="text-[var(--foreground)]">THEN</strong>{' '}
                        <span className="text-[var(--muted-strong)]">
                          set {fieldLabel(actionField)} to “{targetLabel.trim()}”
                        </span>
                      </div>

                      <label className="block text-[10px] font-semibold text-[var(--muted-strong)]">
                        Match source field
                      </label>
                      <SelectInput
                        aria-label="Automation source field"
                        value={ruleMatchField}
                        onChange={(event) => {
                          const field = event.target.value as ImporterV2Field
                          setRuleMatchField(field)
                          setRuleMatch(detail.evaluated.rawValues?.[field] ?? '')
                          setRulePreview(null)
                        }}
                      >
                        {CLIENT_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {fieldLabel(field)}
                          </option>
                        ))}
                      </SelectInput>

                      <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px]">
                        <span className="text-[var(--muted)]">Source value on this row</span>
                        <p className="mt-0.5 break-words font-mono text-[var(--muted-strong)]">
                          {display(ruleSourceValue)}
                        </p>
                        {!ruleSourceValue ? (
                          <p className="mt-1 text-[#f0a0a0]">
                            This source field is blank on the selected row. Choose the column that actually contains the text you want to match.
                          </p>
                        ) : null}
                      </div>

                      <SelectInput
                        aria-label="Automation match type"
                        value={ruleOperator}
                        onChange={(event) => {
                          setRuleOperator(event.target.value as typeof ruleOperator)
                          setRulePreview(null)
                        }}
                      >
                        <option value="NORMALIZED_EXACT">Is exactly</option>
                        <option value="PREFIX">Starts with</option>
                        <option value="CONTAINS">Contains</option>
                        <option value="PATTERN">Wildcard pattern (* and ?)</option>
                        <option value="VERSION_MATCH">Version pattern</option>
                      </SelectInput>
                      <TextInput
                        aria-label="Automation source pattern"
                        value={ruleMatch}
                        onChange={(event) => {
                          setRuleMatch(event.target.value)
                          setRulePreview(null)
                        }}
                        placeholder={ruleOperator === 'PATTERN' ? 'Example: Cisco WS-C2960X-*' : 'Source text to match'}
                      />
                      <p className="text-[10px] leading-4 text-[var(--muted)]">
                        No regex knowledge required. Wildcard uses <code>*</code> for any text and <code>?</code> for one character.
                      </p>
                      <SelectInput
                        aria-label="Automation scope"
                        value={ruleScope}
                        onChange={(event) => {
                          setRuleScope(event.target.value as typeof ruleScope)
                          setRulePreview(null)
                        }}
                      >
                        <option value="PROFILE">This source profile</option>
                        <option value="CUSTOMER">This customer</option>
                        <option value="VENDOR">This vendor</option>
                        <option value="MODEL">This source model</option>
                      </SelectInput>

                      {rulePreview ? (
                        <div className="rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-2 text-xs">
                          <p className="font-semibold">
                            Matches {rulePreview.preview.matchedRowCount.toLocaleString()} staged row{rulePreview.preview.matchedRowCount === 1 ? '' : 's'}
                          </p>
                          {rulePreview.preview.conflicts.length ? (
                            <p className="mt-1 font-semibold text-[#f0a0a0]">
                              {rulePreview.preview.conflicts.length} rule conflict{rulePreview.preview.conflicts.length === 1 ? '' : 's'} — activation is blocked.
                            </p>
                          ) : null}
                          {rulePreview.preview.examples.slice(0, 4).map((example) => (
                            <p key={example.rowNumber} className="mt-1 text-[10px] text-[var(--muted-strong)]">
                              #{example.rowNumber}: {fieldLabel(ruleMatchField)} “{display(example.before[ruleMatchField])}” → {fieldLabel(actionField)} “{display(example.after[actionField])}”
                            </p>
                          ))}
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Button variant="ghost" onClick={() => setRulePreview(null)}>
                              Edit
                            </Button>
                            <Button
                              variant="primary"
                              disabled={ruleBusy || rulePreview.preview.conflicts.length > 0}
                              onClick={() => void applyRulePreview()}
                            >
                              Activate automation
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          className="w-full"
                          disabled={ruleBusy || !ruleMatch.trim()}
                          onClick={() => void requestRulePreview()}
                        >
                          {ruleBusy ? 'Checking…' : 'Preview matching rows'}
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {actionMessage ? (
            <p role="status" className="mt-2 text-xs leading-5 text-[var(--accent-light)]">
              {actionMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}