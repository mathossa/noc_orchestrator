import Image from 'next/image'
import Link from 'next/link'
import { SignInForm } from '@/components/auth/sign-in-form'

function safeReturnPath(candidate: string | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') ||
    candidate.includes('\\') || /[\x00-\x1f]/u.test(candidate) ||
    candidate.startsWith('/login')) {
    return '/settings/integrations'
  }
  return candidate
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const returnTo = safeReturnPath(next)
  return (
    <main className="noc-app-background flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <Image src="/brand/noc-orchestrator-icon.png" alt="" width={48} height={48} className="h-12 w-12 object-contain" />
          <div>
            <div className="text-lg font-semibold">NOC Orchestrator</div>
            <p className="text-xs uppercase tracking-widest text-[var(--accent-light)]">Secure sign-in</p>
          </div>
        </div>
        <h1 className="mb-2 text-xl font-semibold">Sign in</h1>
        <p className="mb-7 text-sm text-[var(--muted)]">
          Sign in with your NOC Orchestrator administrator account to manage integrations and run API checks.
        </p>
        <SignInForm returnTo={returnTo} />
        <div className="mt-6 border-t border-[var(--border)] pt-4 text-center">
          <Link href={returnTo} className="text-sm text-[var(--muted-strong)] underline-offset-4 hover:underline">
            Back to application
          </Link>
        </div>
      </div>
    </main>
  )
}
