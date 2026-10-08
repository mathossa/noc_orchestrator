'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
async function responseData(response: Response) {
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message ?? 'Request failed.')
  return body.data
}
export function MerakiConnectionCreateForm() {
  const router = useRouter()
  const [name, setName] = useState('Cisco Meraki')
  const [environment, setEnvironment] = useState('global')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setMessage(null)
    try {
      const response = await fetch('/api/v1/inventory-sources/meraki', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, environment, apiKey }),
      })
      const connection = await responseData(response)
      router.push(`/settings/integrations/meraki/${connection.id}`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save connection.')
    } finally { setBusy(false) }
  }
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="font-semibold">Name</span>
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3" />
        </label>
        <label className="space-y-1 text-sm"><span className="font-semibold">API environment</span>
          <select aria-label="API environment" value={environment} onChange={(e) => setEnvironment(e.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3">
            <option value="global">Global</option><option value="canada">Canada</option><option value="china">China</option><option value="india">India</option><option value="fedramp">FedRAMP</option>
          </select>
        </label>
        <label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Dashboard API key</span>
          <input aria-label="Dashboard API key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono" />
          <span className="block text-xs text-[var(--muted)]">Stored encrypted server-side and never returned after save.</span>
        </label>
      </div>
      {message ? <p className="mt-4 text-sm text-[var(--warning)]">{message}</p> : null}
      <div className="mt-5 flex justify-end"><Button variant="primary" disabled={busy || !name.trim() || !apiKey.trim()} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save Meraki connection'}</Button></div>
    </section>
  )
}
