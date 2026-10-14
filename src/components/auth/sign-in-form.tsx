'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'

export function SignInForm({ returnTo }: { returnTo: string }) {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      })
      if (result.error) {
        setError(result.error.message ?? 'Unable to sign in. Check your credentials.')
        return
      }
      setPassword('')
      router.replace(returnTo)
      router.refresh()
    } catch {
      setError('Unable to contact authentication service. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending) {
    return <p role="status" className="text-sm text-[var(--muted)]">Checking your session…</p>
  }

  if (session?.user) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-strong)]">
          Signed in as <strong>{session.user.email}</strong>.
        </p>
        <Link
          href={returnTo}
          className="inline-flex min-h-10 items-center rounded-md bg-[var(--accent)] px-4 font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
        >
          Return to NOC Orchestrator
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={(event) => void onSignIn(event)} className="space-y-5">
      <div>
        <label htmlFor="login-email" className="mb-1 block text-sm font-semibold">Email address</label>
        <input
          id="login-email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@example.com"
          className="min-h-11 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm"
        />
      </div>
      <div>
        <label htmlFor="login-password" className="mb-1 block text-sm font-semibold">Password</label>
        <input
          id="login-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="min-h-11 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm"
        />
      </div>
      {error ? <p role="alert" className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="min-h-11 w-full rounded-md bg-[var(--accent)] px-4 font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-xs text-[var(--muted)]">
        Accounts must be created by an administrator. Public registration is disabled.
      </p>
    </form>
  )
}
