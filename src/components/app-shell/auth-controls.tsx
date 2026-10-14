'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

/** Temporary header access to Better Auth while full application sign-in UX evolves. */
export function AuthControls() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, isPending, refetch } = authClient.useSession()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signOut() {
    setSigningOut(true)
    setError(null)
    try {
      const result = await authClient.signOut()
      if (result.error) {
        setError(result.error.message ?? 'Sign out failed.')
        return
      }
      await refetch()
      router.refresh()
    } catch {
      setError('Sign out failed. Please retry.')
    } finally {
      setSigningOut(false)
    }
  }

  if (isPending) {
    return <span role="status" className="text-xs text-[var(--muted)]">Checking session…</span>
  }

  if (!session?.user) {
    return (
      <Link
        href={'/login?next=' + encodeURIComponent(pathname)}
        className="inline-flex min-h-9 items-center rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-3 text-sm font-semibold text-[var(--accent-light)] hover:bg-[var(--accent-muted)]"
      >
        Sign in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden min-w-0 text-right sm:block">
        <div className="max-w-52 truncate text-xs font-medium" title={session.user.email}>
          {session.user.name || session.user.email}
        </div>
        <div className="text-[10px] text-[var(--muted)]">
          {session.user.role === 'admin' ? 'Administrator' : 'Signed in · non-admin'}
        </div>
      </div>
      {error ? <span role="alert" className="max-w-48 text-xs text-[var(--danger)]">{error}</span> : null}
      <button
        type="button"
        disabled={signingOut}
        onClick={() => void signOut()}
        className="inline-flex min-h-9 items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm hover:bg-[var(--surface-muted)] disabled:opacity-60"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  )
}
