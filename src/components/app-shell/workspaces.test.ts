import { describe, expect, it } from 'vitest'
import {
  getWorkspace,
  isActivePath,
  workspaceForPath,
  workspaces,
  type NavigationLink,
} from './workspaces'

describe('workspace navigation', () => {
  it.each([
    ['/dashboard', 'monitor'],
    ['/customers', 'configuration'],
    ['/customers/customer-1', 'configuration'],
    ['/sites', 'configuration'],
    ['/devices', 'monitor'],
    ['/devices/manage', 'configuration'],
    ['/devices/customers/customer-1/sites/site-1/types/firewall', 'monitor'],
    ['/sites/site-1', 'configuration'],
    ['/devices/device-1', 'monitor'],
    ['/reports', 'monitor'],
    ['/reports/inventory', 'monitor'],
    ['/devices/import', 'tasks'],
    ['/devices/import/batch-1', 'tasks'],
    ['/planning', 'tasks'],
    ['/planning/history', 'tasks'],
    ['/firmware/exceptions', 'tasks'],
    ['/firmware/exceptions/exception-1', 'tasks'],
    ['/firmware', 'configuration'],
    ['/firmware/platforms', 'configuration'],
    ['/models', 'configuration'],
    ['/vendors', 'configuration'],
    ['/device-types', 'configuration'],
    ['/contracts', 'configuration'],
    ['/settings', 'configuration'],
    ['/settings/integrations', 'configuration'],
    ['/settings/integrations/aruba/source-1', 'configuration'],
    ['/settings/integrations/import-automation', 'configuration'],
  ] as const)('classifies %s as %s', (path, expected) => {
    expect(workspaceForPath(path)).toBe(expected)
    expect(getWorkspace(path).id).toBe(expected)
  })

  it('excludes task routes from their inventory and firmware parents', () => {
    expect(isActivePath('/devices/import', '/devices')).toBe(false)
    expect(isActivePath('/devices/manage', '/devices')).toBe(false)
    expect(isActivePath('/firmware/exceptions', '/firmware')).toBe(false)
    expect(isActivePath('/devices/device-1', '/devices')).toBe(true)
    expect(isActivePath('/firmware/platforms', '/firmware')).toBe(true)
    expect(isActivePath('/settings/integrations', '/settings')).toBe(false)
  })

  it('keeps configuration-only management separate from monitoring', () => {
    const monitoring = workspaces.find((workspace) => workspace.id === 'monitor')
    const configuration = workspaces.find((workspace) => workspace.id === 'configuration')
    const paths = (items: readonly NavigationLink[]): string[] =>
      items.flatMap((item) => [item.href, ...paths(item.children ?? [])])
    expect(paths(monitoring?.items ?? [])).not.toContain('/customers')
    expect(paths(monitoring?.items ?? [])).not.toContain('/sites')
    expect(paths(configuration?.items ?? [])).toEqual(
      expect.arrayContaining(['/customers', '/sites', '/vendors', '/devices/manage']),
    )
  })

  it('keeps existing functional menu destinations discoverable', () => {
    const links: string[] = []
    const collect = (items: readonly NavigationLink[]) => {
      for (const item of items) {
        links.push(item.href)
        if (item.children) collect(item.children)
      }
    }
    for (const workspace of workspaces) collect(workspace.items)

    for (const required of [
      '/dashboard',
      '/customers',
      '/sites',
      '/devices',
      '/devices/manage',
      '/devices/import',
      '/firmware',
      '/models',
      '/planning',
      '/firmware/exceptions',
      '/reports/inventory',
      '/vendors',
      '/device-types',
      '/contracts',
      '/settings',
      '/settings/integrations',
      '/settings/integrations/import-automation',
    ]) {
      expect(links).toContain(required)
    }
    expect(new Set(links).size).toBe(links.length)
  })
})
