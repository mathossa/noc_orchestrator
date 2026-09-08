'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, TextInput, TextArea } from '@/components/ui/form-controls'
import type { OrganizationUnitRecord } from '@/lib/organization-units'
import type { SiteRecord } from '@/lib/sites'

const empty = { name: '', code: '', notes: '' }
export function CustomerHierarchy({ customerId }: { customerId: string }) {
  const [units, setUnits] = useState<OrganizationUnitRecord[]>([])
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const base = `/api/v1/customers/${customerId}`
  const load = useCallback(async () => {
    const responses = await Promise.all([
      fetch(`${base}/organization-units`, { cache: 'no-store' }),
      fetch(`${base}/sites`, { cache: 'no-store' }),
    ])
    const data = await Promise.all(responses.map((response) => response.json()))
    responses.forEach((response, i) => {
      if (!response.ok)
        throw new Error(
          data[i].error?.message ?? 'Hierarchy could not be loaded.',
        )
    })
    return {
      units: data[0].data as OrganizationUnitRecord[],
      sites: data[1].data as SiteRecord[],
    }
  }, [base])
  useEffect(() => {
    let cancelled = false
    void load()
      .then((data) => {
        if (!cancelled) {
          setUnits(data.units)
          setSites(data.sites)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])
  async function mutate(id: string | null, data: unknown) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(
        `${base}/organization-units${id ? `/${id}` : ''}`,
        {
          method: id ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
      )
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.error?.message ?? 'Unit could not be saved.')
      const refreshed = await load()
      setUnits(refreshed.units)
      setSites(refreshed.sites)
      setEditing(null)
      setForm(empty)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unit could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    void mutate(editing, form)
  }
  const groups = [
    ...units.map((unit) => ({ id: unit.id, name: unit.name, unit })),
    { id: 'none', name: 'Ungrouped', unit: null },
  ]
  return (
    <section
      id="organization-units"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold">Business units and sites</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Group customer sites when needed. Sites can also remain ungrouped.
        </p>
      </div>
      {error && (
        <p role="alert" className="p-4 text-[var(--danger)]">
          {error}
        </p>
      )}
      {loading ? (
        <p className="p-4">Loading hierarchy…</p>
      ) : (
        groups.map((group) => {
          const children = sites.filter(
            (site) => (site.organizationUnitId ?? 'none') === group.id,
          )
          const devices = children.reduce(
            (sum, site) => sum + site.deviceCount,
            0,
          )
          return (
            <div
              key={group.id}
              id={`unit-${group.id}`}
              className="border-b border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {group.unit?.parentId
                    ? `${units.find((unit) => unit.id === group.unit?.parentId)?.name ?? 'Parent'} / `
                    : ''}
                  {group.name}
                  {group.unit && !group.unit.isActive ? ' (inactive)' : ''}
                </h3>
                <Link
                  className="text-sm text-[var(--accent-light)]"
                  href={`/devices?customer=${customerId}&organizationUnit=${group.id}`}
                >
                  {children.length} sites / {devices} devices
                </Link>
              </div>
              {group.unit && (
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    disabled={saving}
                    className="text-[var(--accent-light)]"
                    onClick={() => {
                      setEditing(group.id)
                      setForm({
                        name: group.unit!.name,
                        code: group.unit!.code ?? '',
                        notes: group.unit!.notes ?? '',
                      })
                    }}
                  >
                    Edit unit
                  </button>
                  <button
                    disabled={saving}
                    onClick={() =>
                      void mutate(group.id, { isActive: !group.unit!.isActive })
                    }
                  >
                    {group.unit.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <span className="text-[var(--muted)]">
                    {group.unit.source}
                    {group.unit.externalProvider
                      ? ` · ${group.unit.externalProvider} / ${group.unit.externalId ?? '—'}`
                      : ''}
                  </span>
                </div>
              )}
              {group.unit?.notes && (
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {group.unit.notes}
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {children.map((site) => (
                  <li
                    key={site.id}
                    className="flex justify-between gap-3 pl-3 text-sm"
                  >
                    <Link
                      className="text-[var(--accent-light)]"
                      href={`/customers/${customerId}/sites/${site.id}`}
                    >
                      {site.name}
                      {site.isActive ? '' : ' (archived)'}
                    </Link>
                    <span>{site.deviceCount} devices</span>
                  </li>
                ))}
              </ul>
              {!children.length && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  No sites in this group.
                </p>
              )}
            </div>
          )
        })
      )}
      <form className="space-y-3 p-4" onSubmit={save}>
        <h3 className="text-sm font-semibold">
          {editing ? 'Edit business unit' : 'Add business unit'}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="unit-name">
            <TextInput
              id="unit-name"
              required
              maxLength={160}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField label="Code (optional)" htmlFor="unit-code">
            <TextInput
              id="unit-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </FormField>
        </div>
        <FormField label="Notes" htmlFor="unit-notes">
          <TextArea
            id="unit-notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </FormField>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save unit' : 'Add unit'}
          </Button>
          {editing && (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setForm(empty)
              }}
            >
              Cancel
            </Button>
          )}
          <Link
            className="text-sm text-[var(--accent-light)]"
            href={`/customers/${customerId}/sites`}
          >
            Manage site assignments
          </Link>
        </div>
      </form>
    </section>
  )
}
