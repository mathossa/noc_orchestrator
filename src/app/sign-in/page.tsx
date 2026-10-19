'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedNext = searchParams.get('next')
  const destination = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') && !requestedNext.startsWith('/sign-in') ? requestedNext : '/dashboard'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) {
        setError('Sign-in failed. Check your credentials.')
        return
      }
      router.replace(destination)
      router.refresh()
    } catch {
      setError('Sign-in is temporarily unavailable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8"
      >
        <div>
          <h1 className="text-2xl font-semibold">Sign in to NOC Orchestrator</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Administrator access is required to view network inventory.
          </p>
        </div>
        {searchParams.get('error') === 'forbidden' ? (
          <p role="alert" className="text-sm text-red-500">
            Your account does not have administrator access.
          </p>
        ) : null}
        <label className="block space-y-2 text-sm">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-2.5"
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-2.5"
          />
        </label>
        {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--accent-contrast)] disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}


import { Suspense } from 'react'

export default function SignInPage() {
  return <Suspense fallback={<main className="min-h-screen p-6">Loading sign-in…</main>}><SignInForm /></Suspense>
}
