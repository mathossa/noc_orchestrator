'use client'

import { useMemo, useState } from 'react'

export type SearchableReferenceOption = {
  id: string
  label: string
  keywords?: string[]
}

function normalize(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function matches(option: SearchableReferenceOption, query: string) {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return true
  const terms = normalizedQuery.split(/\s+/g).filter(Boolean)
  const haystack = normalize([option.label, ...(option.keywords ?? [])].join(' '))
  return terms.every((term) => haystack.includes(term))
}

export function SearchableReferencePicker({
  id,
  value,
  options,
  onChange,
  placeholder = 'Type code or name…',
  disabled = false,
}: {
  id: string
  value: string
  options: SearchableReferenceOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const selected = options.find((option) => option.id === value) ?? null
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const displayValue = open ? query : selected?.label ?? query
  const listboxId = `${id}-options`

  const filtered = useMemo(() => options.filter((option) => matches(option, query)).slice(0, 20), [options, query])

  function choose(option: SearchableReferenceOption) {
    onChange(option.id)
    setQuery('')
    setOpen(false)
  }

  function handleChange(next: string) {
    setQuery(next)
    setOpen(true)
    if (value) onChange('')
  }

  return <div className="relative">
    <input
      id={id}
      type="text"
      role="combobox"
      aria-controls={listboxId}
      aria-expanded={open}
      aria-autocomplete="list"
      autoComplete="off"
      disabled={disabled}
      value={displayValue}
      placeholder={placeholder}
      className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      onFocus={() => {
        setOpen(true)
        if (selected) setQuery('')
      }}
      onBlur={() => window.setTimeout(() => setOpen(false), 100)}
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false)
          return
        }
        if (event.key !== 'Enter') return
        const normalizedQuery = normalize(query)
        const exact = filtered.find((option) =>
          normalize(option.label) === normalizedQuery ||
          (option.keywords ?? []).some((keyword) => normalize(keyword) === normalizedQuery),
        )
        const candidate = exact ?? (filtered.length === 1 ? filtered[0] : null)
        if (!candidate) return
        event.preventDefault()
        choose(candidate)
      }}
    />

    {open && !disabled ? <div id={listboxId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-xl">
      {filtered.length ? filtered.map((option) => <button
        key={option.id}
        type="button"
        role="option"
        aria-selected={option.id === value}
        className="block w-full border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--surface-muted)]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        {option.label}
      </button>) : <div className="px-3 py-3 text-sm text-[var(--muted)]">No matching configured record.</div>}
    </div> : null}

    {selected ? <div className="mt-1 text-xs text-[var(--muted)]">Selected: <span className="font-semibold text-[var(--foreground)]">{selected.label}</span></div> : null}
  </div>
}
