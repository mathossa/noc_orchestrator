'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import {
  getWorkspace,
  hasActiveDescendant,
  isActivePath,
  workspaces,
  type NavigationLink,
  type Workspace,
} from './workspaces'

// Preserve the helper's original import path for existing callers and tests.
export { isActivePath } from './workspaces'

function Brand() {
  return (
    <Link
      href="/dashboard"
      className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-md"
      aria-label="NOC Orchestrator dashboard"
    >
      <Image
        src="/brand/noc-orchestrator-icon.png"
        alt=""
        width={40}
        height={40}
        className="h-9 w-9 shrink-0 object-contain"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold tracking-tight text-[var(--foreground)]">
          NOC Orchestrator
        </span>
        <span className="block truncate text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--accent-light)]">
          Firmware lifecycle
        </span>
      </span>
    </Link>
  )
}

function WorkspaceTabs({ activeId }: { activeId: Workspace['id'] }) {
  return (
    <nav aria-label="Workspaces" className="flex min-w-0 items-center gap-1 overflow-x-auto noc-scrollbar">
      {workspaces.map((workspace) => (
        <Link
          key={workspace.id}
          href={workspace.href}
          aria-current={activeId === workspace.id ? 'location' : undefined}
          className={[
            'inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-md border-b-2 px-3 text-sm font-semibold transition-colors',
            activeId === workspace.id
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)]'
              : 'border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
          ].join(' ')}
        >
          {workspace.label}
        </Link>
      ))}
    </nav>
  )
}

function WorkspaceNavigationItem({
  item,
  pathname,
  onNavigate,
  nested = false,
}: {
  item: NavigationLink
  pathname: string
  onNavigate?: () => void
  nested?: boolean
}) {
  const selected = isActivePath(pathname, item.href)
  const childSelected = hasActiveDescendant(pathname, item)
  const exactPage = pathname === item.href

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={exactPage ? 'page' : undefined}
        className={[
          'flex min-h-9 items-center gap-2.5 rounded-md border px-3 text-sm font-medium transition-colors',
          nested ? 'ml-4 text-[13px]' : '',
          selected && !childSelected
            ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
            : childSelected
              ? 'border-transparent bg-[var(--surface-muted)] text-[var(--foreground)]'
              : 'border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'h-1.5 w-1.5 shrink-0 rounded-full',
            selected ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
          ].join(' ')}
        />
        <span className="truncate">{item.label}</span>
      </Link>
      {item.children?.length ? (
        <ul className="mt-0.5 space-y-0.5">
          {item.children.map((child) => (
            <WorkspaceNavigationItem
              key={child.href}
              item={child}
              pathname={pathname}
              onNavigate={onNavigate}
              nested
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function WorkspaceNavigation({
  workspace,
  pathname,
  onNavigate,
}: {
  workspace: Workspace
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label={workspace.label + ' navigation'}>
      <ul className="space-y-1">
        {workspace.items.map((item) => (
          <WorkspaceNavigationItem
            key={item.href}
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </nav>
  )
}

function MobileNavigation({ workspace, pathname }: { workspace: Workspace; pathname: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-workspace-navigation"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm font-semibold hover:bg-[var(--surface-muted)]"
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
          id="mobile-workspace-navigation"
          className="absolute inset-x-0 top-full border-b border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        >
          <div className="noc-scrollbar max-h-[calc(100vh-6rem)] overflow-y-auto px-4 py-4">
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--accent-light)]">
              {workspace.label}
            </p>
            <p className="mb-4 px-3 text-xs leading-5 text-[var(--muted)]">
              {workspace.description}
            </p>
            <WorkspaceNavigation
              workspace={workspace}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const workspace = getWorkspace(pathname)
  const importerWorkspace = pathname.startsWith('/devices/import')

  return (
    <div className="noc-app-background">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <div className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="flex min-h-16 items-center gap-5 px-4 sm:px-6 xl:px-8">
            <Brand />
            <div className="ml-1 hidden min-w-0 flex-1 sm:block">
              <WorkspaceTabs activeId={workspace.id} />
            </div>
            <MobileNavigation key={pathname} workspace={workspace} pathname={pathname} />
          </div>
          <div className="border-t border-[var(--border)] px-2 py-1 sm:hidden">
            <WorkspaceTabs activeId={workspace.id} />
          </div>
        </header>

        <div className="lg:flex">
          <aside className="noc-scrollbar sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] px-3 py-5 lg:flex">
            <div className="mb-4 px-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--accent-light)]">
                {workspace.label}
              </h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                {workspace.description}
              </p>
            </div>
            <WorkspaceNavigation workspace={workspace} pathname={pathname} />
            <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] px-3 pt-4 text-xs text-[var(--muted)]">
              <span>v0.1.0</span>
              <span className="rounded border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-light)]">
                MVP
              </span>
            </div>
          </aside>

          <main
            id="main-content"
            tabIndex={-1}
            className={[
              'mx-auto min-w-0 w-full flex-1 px-4 py-5 sm:px-6 sm:py-7 xl:px-8',
              importerWorkspace ? 'max-w-none' : 'max-w-[1680px]',
            ].join(' ')}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
