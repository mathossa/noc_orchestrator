'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type TenantScope = {
  tenantId: string
  tenantName: string
  customer: string
  businessUnit: string
  site: string
}

function emptyTenant(): TenantScope {
  return {
    tenantId: '',
    tenantName: '',
    customer: '',
    businessUnit: '',
    site: '',
  }
}

async function responseData(response: Response) {
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Request failed.')
  }
  return body.data
}

export function AuvikConnectionCreateForm() {
  const router = useRouter()
  const [name, setName] = useState('Auvik')
  const [region, setRegion] = useState('eu1')
  const [username, setUsername] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tenants, setTenants] = useState<TenantScope[]>([emptyTenant()])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const updateTenant = (
    index: number,
    field: keyof TenantScope,
    value: string,
  ) => {
    setTenants((current) =>
      current.map((tenant, tenantIndex) =>
        tenantIndex === index ? { ...tenant, [field]: value } : tenant,
      ),
    )
  }

  const submit = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/v1/inventory-sources/auvik', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          region,
          username,
          apiKey,
          tenants: tenants.filter((tenant) => tenant.tenantId.trim()),
        }),
      })
      const connection = await responseData(response)
      router.push(`/settings/integrations/auvik/${connection.id}`)
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to create Auvik connection.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          Connection
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
          Credentials are encrypted server-side and are never returned to the
          browser after saving. The connection starts disabled until it passes a
          connection test.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Region</span>
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="eu1"
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Auvik username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Tenant scope</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Configure explicit tenant IDs for the first live slice. Customer /
              Business Unit / Site values are staged as source evidence and still
              pass through normal Importer v2 reconciliation.
            </p>
          </div>
          <Button
            onClick={() => setTenants((current) => [...current, emptyTenant()])}
          >
            Add tenant
          </Button>
        </div>
        <div className="space-y-3 p-5">
          {tenants.map((tenant, index) => (
            <div
              key={index}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4"
            >
              <div className="grid gap-3 lg:grid-cols-5">
                {(
                  [
                    ['tenantId', 'Tenant ID'],
                    ['tenantName', 'Tenant name'],
                    ['customer', 'Customer'],
                    ['businessUnit', 'Business Unit'],
                    ['site', 'Site'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="space-y-1 text-xs">
                    <span className="font-semibold text-[var(--muted-strong)]">
                      {label}
                    </span>
                    <input
                      value={tenant[field]}
                      onChange={(event) =>
                        updateTenant(index, field, event.target.value)
                      }
                      className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
                    />
                  </label>
                ))}
              </div>
              {tenants.length > 1 ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setTenants((current) =>
                        current.filter((_, tenantIndex) => tenantIndex !== index),
                      )
                    }
                  >
                    Remove tenant
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {message ? (
        <div className="rounded-md border border-[#8f4747] bg-[#512b2b] px-4 py-3 text-sm text-[#ffd7d7]">
          {message}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Save Auvik connection'}
        </Button>
      </div>
    </div>
  )
}
