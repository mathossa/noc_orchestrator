export type WorkspaceId = 'monitor' | 'tasks' | 'configuration'

export type NavigationLink = {
  label: string
  href: string
  children?: readonly NavigationLink[]
}

export type Workspace = {
  id: WorkspaceId
  label: string
  description: string
  href: string
  items: readonly NavigationLink[]
}

export const workspaces: readonly Workspace[] = [
  {
    id: 'monitor',
    label: 'Monitor & Reporting',
    description: 'Monitor your estate, explore devices and create reports.',
    href: '/dashboard',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Inventory', href: '/devices' },
      {
        label: 'Reports',
        href: '/reports/inventory',
      },
    ],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Review incoming changes and plan the work.',
    href: '/devices/import',
    items: [
      { label: 'Import reviews', href: '/devices/import' },
      { label: 'Planning', href: '/planning' },
      { label: 'Exceptions', href: '/firmware/exceptions' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    description: 'Manage sources, catalogs, contracts and rules.',
    href: '/settings/integrations',
    items: [
      {
        label: 'Customers & sites',
        href: '/customers',
        children: [
          { label: 'Manage sites', href: '/sites' },
          { label: 'Manage device records', href: '/devices/manage' },
        ],
      },
      {
        label: 'Integrations',
        href: '/settings/integrations',
        children: [{ label: 'Import automation', href: '/settings/integrations/import-automation' }],
      },
      {
        label: 'Firmware catalog',
        href: '/firmware',
        children: [
          { label: 'Models', href: '/models' },
          { label: 'Vendors', href: '/vendors' },
          { label: 'Device types', href: '/device-types' },
        ],
      },
      { label: 'Contracts', href: '/contracts' },
      { label: 'Settings', href: '/settings' },
    ],
  },
]

/**
 * Classify operation-specific routes before their broader inventory/catalog prefixes.
 * Keep old URLs stable while only the navigation structure changes.
 */
export function workspaceForPath(pathname: string): WorkspaceId {
  if (
    pathname === '/devices/import' ||
    pathname.startsWith('/devices/import/') ||
    pathname === '/planning' ||
    pathname.startsWith('/planning/') ||
    pathname === '/firmware/exceptions' ||
    pathname.startsWith('/firmware/exceptions/')
  ) {
    return 'tasks'
  }

  if (
    pathname === '/devices/manage' ||
    pathname.startsWith('/devices/manage/') ||
    pathname === '/customers' ||
    pathname.startsWith('/customers/') ||
    pathname === '/sites' ||
    pathname.startsWith('/sites/') ||
    pathname === '/firmware' ||
    pathname.startsWith('/firmware/') ||
    pathname === '/models' ||
    pathname.startsWith('/models/') ||
    pathname === '/vendors' ||
    pathname.startsWith('/vendors/') ||
    pathname === '/device-types' ||
    pathname.startsWith('/device-types/') ||
    pathname === '/contracts' ||
    pathname.startsWith('/contracts/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  ) {
    return 'configuration'
  }

  return 'monitor'
}

export function getWorkspace(pathname: string): Workspace {
  const id = workspaceForPath(pathname)
  const workspace = workspaces.find((item) => item.id === id)
  if (!workspace) throw new Error('Unknown workspace: ' + id)
  return workspace
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/dashboard' || href === '/settings') return pathname === href
  if (href === '/devices') {
    return (pathname === href || pathname.startsWith(href + '/')) &&
      !pathname.startsWith('/devices/import')
  }
  if (href === '/firmware') {
    return (pathname === href || pathname.startsWith(href + '/')) &&
      !pathname.startsWith('/firmware/exceptions')
  }
  if (href === '/settings/integrations') {
    return (pathname === href || pathname.startsWith(href + '/')) &&
      !pathname.startsWith('/settings/integrations/import-automation')
  }
  if (href === '/reports/inventory') {
    return pathname === href || pathname.startsWith(href + '/')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

export function hasActiveDescendant(pathname: string, link: NavigationLink): boolean {
  return link.children?.some((child) =>
    isActivePath(pathname, child.href) || hasActiveDescendant(pathname, child),
  ) ?? false
}
