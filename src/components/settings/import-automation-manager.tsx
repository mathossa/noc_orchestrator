'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import type {
  ImporterV2AutomationAdminData,
  ImporterV2AutomationExactMappingSummary,
  ImporterV2AutomationRuleBookSummary,
} from '@/lib/importer-v2-automation-admin-store'
import type {
  ImporterV2RuleAction,
  ImporterV2RuleDefinition,
  ImporterV2RuleExpression,
} from '@/lib/importer-v2-rule-types'

type RuleRow = {
  book: ImporterV2AutomationRuleBookSummary
  rule: ImporterV2RuleDefinition
}

function fieldLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function expressionLabel(expression: ImporterV2RuleExpression): string {
  if (expression.kind === 'CONDITION') {
    return `${fieldLabel(expression.field)} ${expression.operator
      .toLowerCase()
      .replaceAll('_', ' ')} “${expression.value}”`
  }
  return expression.items.map(expressionLabel).join(` ${expression.operator} `)
}

function actionLabel(action: ImporterV2RuleAction): string {
  switch (action.type) {
    case 'MAP_VALUE':
      return `${fieldLabel(action.field)} → ${action.target.label}`
    case 'SET_FIELD':
      return `${fieldLabel(action.field)} → ${action.value}`
    case 'CLEAR_FIELD':
      return `Clear ${fieldLabel(action.field)}`
    case 'IGNORE_FIELD':
      return `Ignore ${fieldLabel(action.field)}`
    case 'EXCLUDE_ROW':
      return 'Exclude row'
    case 'TRANSFORM_VALUE':
      return `${fieldLabel(action.field)} · ${action.transform.toLowerCase().replaceAll('_', ' ')}`
    case 'SPLIT_HIERARCHY':
      return `Split ${fieldLabel(action.sourceField)} → ${action.targetFields.map(fieldLabel).join(', ')}`
    case 'MATCH_DEVICE':
      return 'Match canonical device'
  }
}

function ruleScopeLabel(rule: ImporterV2RuleDefinition, data: ImporterV2AutomationAdminData) {
  const profileIds = rule.scope.profileIds ?? []
  const profileNames = profileIds.map(
    (id) => data.profiles.find((profile) => profile.id === id)?.name ?? id,
  )
  const provider = rule.scope.providers?.join(', ')
  const adapter = rule.scope.sourceAdapterIds?.join(', ')
  return [provider, adapter, profileNames.join(', ')].filter(Boolean).join(' · ') || 'Broad'
}

function profileName(profileId: string | null | undefined, data: ImporterV2AutomationAdminData) {
  if (!profileId) return 'All profiles'
  return data.profiles.find((profile) => profile.id === profileId)?.name ?? profileId
}

function ruleRisk(rule: ImporterV2RuleDefinition) {
  for (const action of rule.actions) {
    if (
      action.type === 'MAP_VALUE' &&
      action.field === 'softwarePlatform' &&
      action.target.label.includes(',')
    ) {
      return 'Software platform is a singular observed platform. This rule maps one device to multiple platform values; supported platforms belong on the model compatibility relationship instead.'
    }
  }
  return null
}

async function responseData(response: Response) {
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Request failed.')
  }
  return body.data
}

export function ImportAutomationManager({
  data,
}: {
  data: ImporterV2AutomationAdminData
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'rules' | 'mappings'>('rules')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL')
  const [profileFilter, setProfileFilter] = useState('ALL')
  const [selectedRule, setSelectedRule] = useState<string | null>(null)
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [pending, setPending] = useState<
    | { kind: 'rule'; action: 'ENABLE' | 'DISABLE' | 'REMOVE'; row: RuleRow }
    | { kind: 'mapping'; mapping: ImporterV2AutomationExactMappingSummary }
    | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const rules = useMemo<RuleRow[]>(
    () =>
      data.ruleBooks.flatMap((book) =>
        book.rules.map((rule) => ({ book, rule })),
      ),
    [data.ruleBooks],
  )
  const filteredRules = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return rules.filter(({ rule }) => {
      if (status !== 'ALL' && rule.status !== status) return false
      if (
        profileFilter !== 'ALL' &&
        !(rule.scope.profileIds ?? []).includes(profileFilter)
      ) {
        return false
      }
      if (!needle) return true
      const haystack = [
        rule.name,
        rule.description ?? '',
        expressionLabel(rule.when),
        ...rule.actions.map(actionLabel),
        ruleScopeLabel(rule, data),
        rule.id,
      ]
        .join(' ')
        .toLocaleLowerCase('en-US')
      return haystack.includes(needle)
    })
  }, [rules, search, status, profileFilter, data])

  const filteredMappings = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return data.exactMappings.filter((mapping) => {
      if (
        profileFilter !== 'ALL' &&
        mapping.profileId !== null &&
        mapping.profileId !== profileFilter
      ) {
        return false
      }
      if (!needle) return true
      return [
        mapping.field,
        mapping.normalizedInput,
        mapping.target.label,
        mapping.provider,
        profileName(mapping.profileId, data),
        mapping.explanation,
      ]
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(needle)
    })
  }, [data, search, profileFilter])

  const activeRule =
    rules.find(({ book, rule }) => `${book.id}:${rule.id}` === selectedRule) ??
    filteredRules[0] ??
    null
  const activeMapping =
    data.exactMappings.find((mapping) => mapping.mappingKey === selectedMapping) ??
    filteredMappings[0] ??
    null

  const mutateRule = async (
    row: RuleRow,
    action: 'ENABLE' | 'DISABLE' | 'REMOVE',
  ) => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/automations/rules/${encodeURIComponent(
          row.book.id,
        )}/${encodeURIComponent(row.rule.id)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      )
      const result = await responseData(response)
      setPending(null)
      setSelectedRule(null)
      setMessage(
        `${action === 'REMOVE' ? 'Removed' : action === 'DISABLE' ? 'Disabled' : 'Enabled'} “${row.rule.name}”. Active revision is now v${result.version}.`,
      )
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update rule.')
    } finally {
      setBusy(false)
    }
  }

  const deactivateMapping = async (
    mapping: ImporterV2AutomationExactMappingSummary,
  ) => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/automations/exact-mappings/${encodeURIComponent(
          mapping.mappingKey,
        )}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'DEACTIVATE' }),
        },
      )
      await responseData(response)
      setPending(null)
      setSelectedMapping(null)
      setMessage(`Deactivated remembered mapping “${mapping.normalizedInput}”.`)
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to deactivate remembered mapping.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)]">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setTab('rules')
              setSelectedMapping(null)
              setPending(null)
            }}
            className={[
              'border-b-2 px-4 py-2.5 text-sm font-semibold',
              tab === 'rules'
                ? 'border-[var(--accent)] text-[var(--accent-light)]'
                : 'border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]',
            ].join(' ')}
          >
            Rules <span className="ml-1 text-xs text-[var(--muted)]">{rules.length}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('mappings')
              setSelectedRule(null)
              setPending(null)
            }}
            className={[
              'border-b-2 px-4 py-2.5 text-sm font-semibold',
              tab === 'mappings'
                ? 'border-[var(--accent)] text-[var(--accent-light)]'
                : 'border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]',
            ].join(' ')}
          >
            Exact mappings
            <span className="ml-1 text-xs text-[var(--muted)]">
              {data.exactMappings.length}
            </span>
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--info-border)] bg-[var(--info-soft)] px-4 py-3 text-sm text-[var(--muted-strong)]">
        Saved importer decisions are versioned. Disabling or removing a rule creates a new
        active revision; previous revisions remain available in history.
      </div>

      {message ? (
        <div
          role="status"
          className="rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--foreground)]"
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px]">
        <input
          aria-label="Search import automations"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={
            tab === 'rules'
              ? 'Search rules, model, vendor, platform…'
              : 'Search exact mappings…'
          }
          className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
        />
        <select
          aria-label="Filter import profile"
          value={profileFilter}
          onChange={(event) => setProfileFilter(event.target.value)}
          className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"
        >
          <option value="ALL">All profiles</option>
          {data.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.provider} · {profile.name}
            </option>
          ))}
        </select>
        {tab === 'rules' ? (
          <select
            aria-label="Filter rule status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as 'ALL' | 'ACTIVE' | 'DISABLED')
            }
            className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
        ) : (
          <div />
        )}
      </div>

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {tab === 'rules' ? (
            filteredRules.length ? (
              <div className="noc-scrollbar overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Rule / condition</th>
                      <th className="px-3 py-2.5">Actions</th>
                      <th className="px-3 py-2.5">Scope</th>
                      <th className="px-3 py-2.5 text-right">Revision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredRules.map((row) => {
                      const key = `${row.book.id}:${row.rule.id}`
                      const selected = activeRule
                        ? key === `${activeRule.book.id}:${activeRule.rule.id}`
                        : false
                      return (
                        <tr
                          key={key}
                          className={[
                            'cursor-pointer transition-colors hover:bg-[var(--surface-muted)]',
                            selected ? 'bg-[var(--accent-soft)]' : '',
                          ].join(' ')}
                          onClick={() => {
                            setSelectedRule(key)
                            setPending(null)
                            setShowHistory(false)
                          }}
                        >
                          <td className="px-3 py-3">
                            <StatusBadge
                              tone={row.rule.status === 'ACTIVE' ? 'success' : 'neutral'}
                            >
                              {row.rule.status}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-3">
                            <div className="font-semibold text-[var(--foreground)]">
                              {row.rule.name}
                            </div>
                            <div className="mt-1 text-xs text-[var(--muted)]">
                              {expressionLabel(row.rule.when)}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                              {row.rule.id}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-[var(--muted-strong)]">
                            {row.rule.actions.map(actionLabel).join(' · ')}
                          </td>
                          <td className="px-3 py-3 text-xs text-[var(--muted-strong)]">
                            {ruleScopeLabel(row.rule, data)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs">
                            v{row.book.activeRevisionVersion ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-12 text-center text-sm text-[var(--muted)]">
                No saved rules match these filters.
              </div>
            )
          ) : filteredMappings.length ? (
            <div className="noc-scrollbar overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
                    <th className="px-3 py-2.5">Field</th>
                    <th className="px-3 py-2.5">Source value</th>
                    <th className="px-3 py-2.5">Canonical target</th>
                    <th className="px-3 py-2.5">Scope</th>
                    <th className="px-3 py-2.5 text-right">Version</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredMappings.map((mapping) => (
                    <tr
                      key={mapping.mappingKey}
                      className={[
                        'cursor-pointer transition-colors hover:bg-[var(--surface-muted)]',
                        activeMapping?.mappingKey === mapping.mappingKey
                          ? 'bg-[var(--accent-soft)]'
                          : '',
                      ].join(' ')}
                      onClick={() => {
                        setSelectedMapping(mapping.mappingKey)
                        setPending(null)
                        setShowHistory(false)
                      }}
                    >
                      <td className="px-3 py-3 font-semibold text-[var(--foreground)]">
                        {fieldLabel(mapping.field)}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {mapping.normalizedInput}
                      </td>
                      <td className="px-3 py-3">{mapping.target.label}</td>
                      <td className="px-3 py-3 text-xs text-[var(--muted-strong)]">
                        {mapping.provider} · {profileName(mapping.profileId, data)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs">
                        v{mapping.version}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-[var(--muted)]">
              No remembered exact mappings match this search.
            </div>
          )}
        </section>

        <aside className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          {tab === 'rules' && activeRule ? (
            <div className="space-y-4">
              <div>
                <StatusBadge
                  tone={activeRule.rule.status === 'ACTIVE' ? 'success' : 'neutral'}
                >
                  {activeRule.rule.status}
                </StatusBadge>
                <h2 className="mt-3 text-lg font-semibold text-[var(--foreground)]">
                  {activeRule.rule.name}
                </h2>
                <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                  {activeRule.rule.id}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {activeRule.rule.status === 'ACTIVE' ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPending({
                        kind: 'rule',
                        action: 'DISABLE',
                        row: activeRule,
                      })
                    }
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setPending({
                        kind: 'rule',
                        action: 'ENABLE',
                        row: activeRule,
                      })
                    }
                  >
                    Enable
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={() =>
                    setPending({
                      kind: 'rule',
                      action: 'REMOVE',
                      row: activeRule,
                    })
                  }
                >
                  Remove
                </Button>
              </div>

              <div className="space-y-3 border-t border-[var(--border)] pt-4 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Condition
                  </div>
                  <div className="mt-1 text-[var(--foreground)]">
                    {expressionLabel(activeRule.rule.when)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Actions
                  </div>
                  <div className="mt-1 space-y-1 text-[var(--foreground)]">
                    {activeRule.rule.actions.map((action, index) => (
                      <div key={index}>{actionLabel(action)}</div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Scope
                  </div>
                  <div className="mt-1 text-[var(--muted-strong)]">
                    {ruleScopeLabel(activeRule.rule, data)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-[var(--muted)]">Priority</div>
                    <div className="font-mono">{activeRule.rule.priority}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--muted)]">Active revision</div>
                    <div className="font-mono">
                      v{activeRule.book.activeRevisionVersion ?? '—'}
                    </div>
                  </div>
                </div>
                {ruleRisk(activeRule.rule) ? (
                  <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--warning)]">
                      Review this rule
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
                      {ruleRisk(activeRule.rule)}
                    </p>
                  </div>
                ) : null}
                {activeRule.rule.description ? (
                  <div>
                    <div className="text-xs text-[var(--muted)]">Description</div>
                    <div className="mt-1 leading-5 text-[var(--muted-strong)]">
                      {activeRule.rule.description}
                    </div>
                  </div>
                ) : null}
              </div>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setShowHistory((value) => !value)}
              >
                {showHistory ? 'Hide revision history' : 'View revision history'}
              </Button>

              {showHistory ? (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  {activeRule.book.revisions.map((revision) => (
                    <div
                      key={revision.id}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong>Revision {revision.version}</strong>
                        {revision.version === activeRule.book.activeRevisionVersion ? (
                          <span className="text-[var(--success)]">Active</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[var(--muted)]">
                        {revision.ruleCount} rules ·{' '}
                        {new Date(revision.createdAt).toLocaleString()}
                      </div>
                      {revision.reason ? (
                        <div className="mt-1 leading-5 text-[var(--muted-strong)]">
                          {revision.reason}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : tab === 'mappings' && activeMapping ? (
            <div className="space-y-4">
              <div>
                <StatusBadge tone="success">Active</StatusBadge>
                <h2 className="mt-3 text-lg font-semibold text-[var(--foreground)]">
                  {fieldLabel(activeMapping.field)}
                </h2>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Remembered exact source value
                </div>
              </div>

              <div className="space-y-3 border-t border-[var(--border)] pt-4 text-sm">
                <div>
                  <div className="text-xs text-[var(--muted)]">Source value</div>
                  <div className="mt-1 font-mono">{activeMapping.normalizedInput}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">Canonical target</div>
                  <div className="mt-1 font-semibold text-[var(--foreground)]">
                    {activeMapping.target.label}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">Scope</div>
                  <div className="mt-1">
                    {activeMapping.provider} ·{' '}
                    {profileName(activeMapping.profileId, data)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">Explanation</div>
                  <div className="mt-1 leading-5 text-[var(--muted-strong)]">
                    {activeMapping.explanation}
                  </div>
                </div>
              </div>

              <Button
                variant="danger"
                onClick={() =>
                  setPending({ kind: 'mapping', mapping: activeMapping })
                }
              >
                Deactivate mapping
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setShowHistory((value) => !value)}
              >
                {showHistory ? 'Hide mapping history' : 'View mapping history'}
              </Button>
              {showHistory ? (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  {activeMapping.history.map((version) => (
                    <div
                      key={version.id}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong>Version {version.version}</strong>
                        <span
                          className={
                            version.isActive
                              ? 'text-[var(--success)]'
                              : 'text-[var(--muted)]'
                          }
                        >
                          {version.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-1 text-[var(--muted)]">
                        {new Date(version.createdAt).toLocaleString()}
                      </div>
                      <div className="mt-1 leading-5 text-[var(--muted-strong)]">
                        {version.explanation}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-[var(--muted)]">
              Select an item to inspect it.
            </div>
          )}

          {pending ? (
            <div className="mt-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-sm">
              <div className="font-semibold text-[var(--foreground)]">
                {pending.kind === 'rule'
                  ? pending.action === 'REMOVE'
                    ? 'Remove this rule from the active set?'
                    : `${pending.action === 'DISABLE' ? 'Disable' : 'Enable'} this rule?`
                  : 'Deactivate this remembered mapping?'}
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
                History is preserved. This action changes what future imports apply.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant={pending.kind === 'rule' && pending.action === 'ENABLE' ? 'primary' : 'danger'}
                  disabled={busy}
                  onClick={() =>
                    pending.kind === 'rule'
                      ? void mutateRule(pending.row, pending.action)
                      : void deactivateMapping(pending.mapping)
                  }
                >
                  {busy ? 'Applying…' : 'Confirm'}
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
