import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell/app-shell'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ApplicationLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Layout auth complements proxy; RSC data is never fetched for anonymous users.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/sign-in')
  if (session.user.role !== 'admin') redirect('/sign-in?error=forbidden')
  return <AppShell>{children}</AppShell>
}
