'use client'

import { useEffect, useState } from 'react'

export type AuvikLookupField = 'customer' | 'businessUnit' | 'site'

export type AuvikLookupOption = {
  id: string
  name: string
  customerName: string
  businessUnit: string | null
  relation: 'SAME_CUSTOMER' | 'OTHER_CUSTOMER'
}

type MatchResponse = {
  options: AuvikLookupOption[]
  status: 'EXISTING' | 'AMBIGUOUS' | 'POSSIBLE_DUPLICATE' | 'NOT_FOUND'
}

type Props = {
  connectionId: string
  field: AuvikLookupField
  tenantLabel: string
  value: string
  customer: string
  businessUnit: string
  disabled?: boolean
  onChange: (value: string) => void
  onSelect: (option: AuvikLookupOption) => void
}

/**
 * Server-scoped canonical typeahead: suggestions are selected explicitly,
 * and a different customer's site is never silently assigned.
 */
export function AuvikMappingInput({
  connectionId, field, tenantLabel, value, customer, businessUnit,
  disabled, onChange, onSelect,
}: Props) {
  const [focused, setFocused] = useState(false)
  const [lookup, setLookup] = useState<(MatchResponse & { value: string; customer: string }) | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!focused || value.trim().length < 2) return
    const abortController = new AbortController()
    const timeout = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ field, q: value, customer, businessUnit })
        const response = await fetch(
          '/api/v1/inventory-sources/auvik/' + encodeURIComponent(connectionId) + '/matches?' + params.toString(),
          { signal: abortController.signal },
        )
        if (!response.ok) throw new Error('Canonical lookup failed')
        const payload = (await response.json()) as { data: MatchResponse }
        if (!abortController.signal.aborted) {
          setLookup({ ...payload.data, value, customer })
        }
      } catch {
        if (!abortController.signal.aborted) setLookup(null)
      } finally {
        if (!abortController.signal.aborted) setLoading(false)
      }
    }, 240)
    return () => {
      clearTimeout(timeout)
      abortController.abort()
    }
  }, [focused, connectionId, field, value, customer, businessUnit])

  const result = lookup?.value === value && lookup.customer === customer ? lookup : null
  const options = result?.options ?? []
  const matched = result?.status === 'EXISTING'
  const siteExistsLabel = field === 'site' && matched ? 'Existing site in this customer' : null

  return (
    <div className="relative min-w-40 space-y-1">
      <input
        aria-label={field + ' for ' + tenantLabel}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field === 'businessUnit' ? 'Optional' : 'Not mapped'}
        className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5"
      />
      {siteExistsLabel ? (
        <div className="text-xs text-[var(--success)]">{siteExistsLabel}</div>
      ) : result?.status === 'POSSIBLE_DUPLICATE' && field === 'site' ? (
        <div className="text-xs text-[var(--warning)]">Possible existing site under a different customer or unit</div>
      ) : result?.status === 'AMBIGUOUS' ? (
        <div className="text-xs text-[var(--warning)]">More than one exact match — choose carefully</div>
      ) : null}
      {focused && value.trim().length >= 2 && (loading || options.length > 0) ? (
        <div className="mt-1 max-h-48 min-w-60 w-full overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-lg">
          {loading ? <div className="px-3 py-2 text-xs text-[var(--muted)]">Finding existing {field}s…</div> : null}
          {options.map((option) => {
            const other = field === 'site' && option.relation === 'OTHER_CUSTOMER'
            return (
              <button
                key={option.id}
                type="button"
                disabled={other}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(option)
                  setFocused(false)
                }}
                className="block w-full border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block text-sm font-medium">{option.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {field === 'site' ? (other ? 'Other customer · ' : 'Existing site · ') : 'Existing · '}
                  {option.customerName}
                  {option.businessUnit ? ' / ' + option.businessUnit : ''}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
