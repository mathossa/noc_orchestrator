'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const navigation = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Customers', href: '/customers' },
  { label: 'Devices', href: '/devices' },
  { label: 'Models', href: '/models' },
  { label: 'Vendors', href: '/vendors' },
  { label: 'Firmware', href: '/firmware' },
  { label: 'Planning', href: '/planning' },
  { label: 'Reports', href: '/reports' },
  { label: 'Settings', href: '/settings' },
] as const

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavigationLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary navigation" className={compact ? 'noc-scrollbar overflow-x-auto' : ''}>
      <ul className={compact ? 'flex min-w-max gap-1 px-3 pb-3' : 'space-y-1'}>
        {navigation.map((item) => {
          const active = isActivePath(pathname, item.href)

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'group flex items-center rounded-md text-sm font-medium transition-colors',
                  compact ? 'h-9 px-3' : 'h-9 gap-3 px-3',
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--foreground)]'
                    : 'text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
                ].join(' ')}
              >
                {!compact ? (
                  <span
                    aria-hidden="true"
                    className={[
                      'h-1.5 w-1.5 rounded-full transition-colors',
                      active ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)] group-hover:bg-[var(--muted)]',
                    ].join(' ')}
                  />
                ) : null}
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Brand() {
  return (
    <Link href="/dashboard" className="block rounded-md" aria-label="NOC Orchestrator dashboard">
      <div className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">NOC Orchestrator</div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
        Firmware lifecycle
      </div>
    </Link>
  )
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-[var(--border)] bg-[var(--surface)] lg:flex lg:flex-col">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <Brand />
        </div>
        <div className="flex-1 px-3 py-4">
          <NavigationLinks />
        </div>
        <div className="border-t border-[var(--border)] px-5 py-4">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span>v0.1.0</span>
            <span className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-medium uppercase tracking-wider">
              MVP
            </span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_94%,transparent)] backdrop-blur lg:hidden">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <Brand />
            <span className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              MVP
            </span>
          </div>
          <NavigationLinks compact />
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
