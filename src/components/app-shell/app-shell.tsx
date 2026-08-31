'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

type NavigationLink = { label: string; href: string }
type NavigationGroup = { label: string; children: readonly NavigationLink[] }
type NavigationItem = NavigationLink | NavigationGroup

const navigation: readonly NavigationItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  {
    label: 'Customers',
    children: [
      { label: 'Overview', href: '/customers' },
      { label: 'Sites', href: '/sites' },
    ],
  },
  { label: 'Devices', href: '/devices' },
  { label: 'Models', href: '/models' },
  { label: 'Vendors', href: '/vendors' },
  { label: 'Device types', href: '/device-types' },
  { label: 'Contract types', href: '/contracts' },
  { label: 'Firmware', href: '/firmware' },
  { label: 'Planning', href: '/planning' },
  { label: 'Reports', href: '/reports' },
  { label: 'Settings', href: '/settings' },
] as const

function isCustomerSitePath(pathname: string) {
  return pathname === '/sites' || pathname.startsWith('/sites/') || /^\/customers\/[^/]+\/sites(?:\/|$)/.test(pathname)
}

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href
  if (href === '/sites') return isCustomerSitePath(pathname)
  if (href === '/customers') {
    return (pathname === href || pathname.startsWith(`${href}/`)) && !isCustomerSitePath(pathname)
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavigationLinkItem({ item, compact = false, nested = false }: { item: NavigationLink; compact?: boolean; nested?: boolean }) {
  const pathname = usePathname()
  const active = isActivePath(pathname, item.href)

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={[
        'group flex items-center rounded-md border text-sm font-medium transition-colors',
        compact ? 'h-9 px-3' : nested ? 'h-8 gap-3 pl-7 pr-3 text-[13px]' : 'h-9 gap-3 px-3',
        active
          ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
          : 'border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
      ].join(' ')}
    >
      {!compact ? (
        <span
          aria-hidden="true"
          className={[
            nested ? 'h-1 w-1' : 'h-1.5 w-1.5',
            'rounded-full transition-colors',
            active ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)] group-hover:bg-[var(--muted)]',
          ].join(' ')}
        />
      ) : null}
      {item.label}
    </Link>
  )
}

function NavigationLinks({ compact = false }: { compact?: boolean }) {
  if (compact) {
    const compactLinks = navigation.flatMap((item) => {
      if ('href' in item) return [item]
      return item.children.map((child) => ({
        ...child,
        label: child.href === '/customers' ? item.label : child.label,
      }))
    })

    return (
      <nav aria-label="Primary navigation" className="noc-scrollbar overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-3 pb-3">
          {compactLinks.map((item) => (
            <li key={item.href}>
              <NavigationLinkItem item={item} compact />
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <nav aria-label="Primary navigation">
      <ul className="space-y-1">
        {navigation.map((item) => {
          if ('href' in item) {
            return (
              <li key={item.href}>
                <NavigationLinkItem item={item} />
              </li>
            )
          }

          return (
            <li key={item.label} className="pt-1">
              <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {item.label}
              </div>
              <ul className="space-y-0.5 border-l border-[var(--border)] ml-3">
                {item.children.map((child) => (
                  <li key={child.href}>
                    <NavigationLinkItem item={child} nested />
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Brand() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-3 rounded-md"
      aria-label="NOC Orchestrator dashboard"
    >
      <Image
        src="/brand/noc-orchestrator-icon.png"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 object-contain"
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold tracking-tight text-[var(--foreground)]">NOC Orchestrator</span>
        <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent-light)]">
          Firmware lifecycle
        </span>
      </span>
    </Link>
  )
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
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
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavigationLinks />
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
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)] lg:hidden">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <Brand />
            <span className="rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-light)]">
              MVP
            </span>
          </div>
          <NavigationLinks compact />
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
