'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

type NavigationLink = { label: string; href: string }
type NavigationGroup = { label: string; children: readonly NavigationLink[] }

const navigation: readonly NavigationGroup[] = [
  {
    label: 'Overview',
    children: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    label: 'Inventory',
    children: [
      { label: 'Customers', href: '/customers' },
      { label: 'Sites', href: '/sites' },
      { label: 'Devices', href: '/devices' },
      { label: 'Import', href: '/devices/import' },
    ],
  },
  {
    label: 'Firmware',
    children: [
      { label: 'Catalog', href: '/firmware' },
      { label: 'Models', href: '/models' },
    ],
  },
  {
    label: 'Operations',
    children: [
      { label: 'Planning', href: '/planning' },
      { label: 'Reports', href: '/reports' },
    ],
  },
  {
    label: 'Administration',
    children: [
      { label: 'Vendors', href: '/vendors' },
      { label: 'Device types', href: '/device-types' },
      { label: 'Contract types', href: '/contracts' },
      { label: 'Settings', href: '/settings' },
    ],
  },
]

function isCustomerSitePath(pathname: string) {
  return pathname === '/sites' || pathname.startsWith('/sites/') || /^\/customers\/[^/]+\/sites(?:\/|$)/.test(pathname)
}

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href
  if (href === '/sites') return isCustomerSitePath(pathname)
  if (href === '/customers') {
    return (pathname === href || pathname.startsWith(`${href}/`)) && !isCustomerSitePath(pathname)
  }
  if (href === '/devices') {
    return (pathname === href || pathname.startsWith(`${href}/`)) && !pathname.startsWith('/devices/import')
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavigationLinkItem({
  item,
  onNavigate,
}: {
  item: NavigationLink
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const active = isActivePath(pathname, item.href)

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={[
        'group flex min-h-9 items-center gap-3 rounded-md border px-3 text-sm font-medium transition-colors',
        active
          ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
          : 'border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
          active ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)] group-hover:bg-[var(--muted)]',
        ].join(' ')}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

function NavigationGroups({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary navigation">
      <ul className="space-y-4">
        {navigation.map((group) => (
          <li key={group.label}>
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.children.map((item) => (
                <li key={item.href}>
                  <NavigationLinkItem item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/dashboard"
      className="flex min-w-0 items-center gap-3 rounded-md"
      aria-label="NOC Orchestrator dashboard"
    >
      <Image
        src="/brand/noc-orchestrator-icon.png"
        alt=""
        width={40}
        height={40}
        className={compact ? 'h-9 w-9 shrink-0 object-contain' : 'h-10 w-10 shrink-0 object-contain'}
      />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
          NOC Orchestrator
        </span>
        {!compact ? (
          <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--accent-light)]">
            Firmware lifecycle
          </span>
        ) : null}
      </span>
    </Link>
  )
}

function MobileNavigation() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-primary-navigation"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
      >
        <span aria-hidden="true" className="grid gap-1">
          <span className="h-px w-4 bg-current" />
          <span className="h-px w-4 bg-current" />
          <span className="h-px w-4 bg-current" />
        </span>
        Menu
      </button>

      {open ? (
        <div
          id="mobile-primary-navigation"
          className="absolute inset-x-0 top-full border-b border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        >
          <div className="noc-scrollbar max-h-[calc(100vh-4rem)] overflow-y-auto px-4 py-4 sm:px-6">
            <NavigationGroups onNavigate={() => setOpen(false)} />
            <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
              <span>v0.1.0</span>
              <span className="rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-medium uppercase tracking-wider text-[var(--accent-light)]">
                MVP
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()

  return (
    <div className="noc-app-background">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-[var(--border)] bg-[var(--surface)] lg:flex lg:flex-col">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <Brand />
        </div>
        <div className="noc-scrollbar flex-1 overflow-y-auto px-3 py-4">
          <NavigationGroups />
        </div>
        <div className="border-t border-[var(--border)] px-5 py-4">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span>v0.1.0</span>
            <span className="rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-medium uppercase tracking-wider text-[var(--accent-light)]">
              MVP
            </span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)] lg:hidden">
          <div className="relative flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <Brand compact />
            <MobileNavigation key={pathname} />
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
