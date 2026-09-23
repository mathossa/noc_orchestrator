import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { isActivePath, NavigationGroups } from './app-shell'

const navigationState = vi.hoisted(() => ({ pathname: '/sites' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
}))

describe('app shell inventory navigation', () => {
  it('keeps customer-scoped site routes under Customers', () => {
    expect(isActivePath('/customers', '/customers')).toBe(true)
    expect(isActivePath('/customers/customer-1', '/customers')).toBe(true)
    expect(isActivePath('/customers/customer-1/sites', '/customers')).toBe(true)
    expect(isActivePath('/customers/customer-1/sites/site-1', '/customers')).toBe(true)

    expect(isActivePath('/customers/customer-1/sites/site-1', '/sites')).toBe(false)
  })

  it('uses All sites only for standalone site routes', () => {
    expect(isActivePath('/sites', '/sites')).toBe(true)
    expect(isActivePath('/sites/example', '/sites')).toBe(true)
    expect(isActivePath('/sites', '/customers')).toBe(false)
  })

  it('gives aria-current only to the actual page link', () => {
    navigationState.pathname = '/sites'
    const allSitesHtml = renderToStaticMarkup(createElement(NavigationGroups))
    expect(allSitesHtml.match(/aria-current="page"/g)).toHaveLength(1)
    expect(allSitesHtml).toContain('All sites')
    expect(allSitesHtml).not.toContain('border-l')

    navigationState.pathname = '/customers/customer-1/sites/site-1'
    const customerSiteHtml = renderToStaticMarkup(createElement(NavigationGroups))
    expect(customerSiteHtml.match(/aria-current="page"/g)).toHaveLength(1)
    expect(customerSiteHtml).toContain('Customers')
  })
})
