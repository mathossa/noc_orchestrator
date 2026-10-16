import { describe, expect, it } from 'vitest'
import { chooseAuvikMappingSuggestion, cleanAuvikHierarchyLabel, deriveAuvikHierarchyProposal, inferAuvikProposalFromKnownCustomer, normalizeAuvikHierarchyNames, normalizeAuvikNamingPolicy, suggestAuvikTenantHierarchy, upgradeLegacyAuvikSiteLabel } from '@/lib/auvik-tenant-matching'
import type { AuvikTenantResource } from '@/lib/auvik-api-client'

const customer = {
  name: 'Northwind',
  organizationUnits: [{ id: 'ou-1', name: 'Corporate', isActive: true }],
  sites: [
    { name: 'Headquarters', isActive: true, organizationUnitId: 'ou-1' },
    { name: 'Warehouse', isActive: true, organizationUnitId: null },
  ],
}

const tenant = (attributes: AuvikTenantResource['attributes']): AuvikTenantResource => ({
  id: '12345', type: 'tenant', attributes,
})

describe('Auvik default canonical naming policy', () => {
  it('removes only trailing numeric bracket labels', () => {
    expect(cleanAuvikHierarchyLabel('Northwind Logistics - [12345]')).toBe('Northwind Logistics')
    expect(cleanAuvikHierarchyLabel('Contoso Labs BV [67890]')).toBe('Contoso Labs BV')
    expect(cleanAuvikHierarchyLabel('Network [Lab]')).toBe('Network [Lab]')
    expect(cleanAuvikHierarchyLabel('Example - [Not a number]')).toBe('Example - [Not a number]')
  })

  it.each([
    { names: ['Contoso Holdings NV - [34567]', 'Contoso - Depot-West - VK'], expected: { customer: 'Contoso Holdings NV', businessUnit: null, site: 'Depot-West - VK' } },
    { names: ['Fabrikam Outreach - [45678]', 'Fabrikam Outreach - 1234AB12'], expected: { customer: 'Fabrikam Outreach', businessUnit: null, site: '1234AB12' } },
    { names: ['Contoso Foundation - [56789]', 'Contoso - Industrial Park - Block B'], expected: { customer: 'Contoso Foundation', businessUnit: null, site: 'Industrial Park - Block B' } },
    { names: ['Fabrikam Motors B.V. [54321]', 'Fabrikam - Plant Alpha'], expected: { customer: 'Fabrikam Motors B.V.', businessUnit: null, site: 'Plant Alpha' } },
    { names: ['Northwind Automotive BV - [65432]', 'Northwind Automotive - Site East'], expected: { customer: 'Northwind Automotive BV', businessUnit: null, site: 'Site East' } },
    { names: ['Adventure Works Group BV - [76543]', 'Adventure Works Group - Fabrikam Installations Nijmegen'], expected: { customer: 'Adventure Works Group BV', businessUnit: null, site: 'Fabrikam Installations Nijmegen' } },
    { names: ['Northwind Logistics - [12345]', 'Northwind Logistics - Open Internet', 'Northwind Logistics - Depot North - Lane A - Open Internet'], expected: { customer: 'Northwind Logistics', businessUnit: 'Open Internet', site: 'Depot North - Lane A' } },
    { names: ['Northwind Logistics - [12345]', 'Northwind Logistics - eCom - [12345]', 'Northwind Logistics - eCom - Hub Alpha'], expected: { customer: 'Northwind Logistics', businessUnit: 'eCom', site: 'Hub Alpha' } },
    { names: ['Adventure Works Group BV - [76543]', 'Warehouse Set 18 - North (City A)'], expected: { customer: 'Adventure Works Group BV', businessUnit: null, site: 'Warehouse Set 18 - North (City A)' } },
  ])('normalizes Auvik path $names', ({ names, expected }) => {
    expect(normalizeAuvikHierarchyNames(names)).toEqual(expected)
  })

  it('maps DHL site names with a verified Business Unit suffix', () => {
    expect(normalizeAuvikHierarchyNames([
      'Northwind Logistics - [12345]',
      'Northwind Logistics - Open Internet',
      'Northwind Logistics - Site Alpha - Open Internet',
    ])).toEqual({
      customer: 'Northwind Logistics', businessUnit: 'Open Internet', site: 'Site Alpha',
    })
    expect(inferAuvikProposalFromKnownCustomer(
      'Northwind Logistics - Site Alpha - Open Internet',
      'Northwind Logistics',
      ['Open Internet'],
    )).toEqual({
      customer: 'Northwind Logistics', businessUnit: 'Open Internet', site: 'Site Alpha',
    })
  })

  it('recognizes a saved BU that still repeats the Customer name', () => {
    expect(inferAuvikProposalFromKnownCustomer(
      'Northwind Logistics - Site Alpha - Open Internet',
      'Northwind Logistics',
      ['Northwind Logistics - Open Internet'],
    )).toEqual({
      customer: 'Northwind Logistics',
      businessUnit: 'Open Internet',
      site: 'Site Alpha',
    })
  })

  it('upgrades only previous auto-derived Auvik site labels', () => {
    const raw = 'Northwind Logistics - Site Alpha - Open Internet'
    expect(upgradeLegacyAuvikSiteLabel(
      raw, raw, 'Northwind Logistics', 'Site Alpha', 'Open Internet',
    )).toBe('Site Alpha')
    expect(upgradeLegacyAuvikSiteLabel(
      'Site Alpha - Open Internet', raw,
      'Northwind Logistics', 'Site Alpha', 'Open Internet',
    )).toBe('Site Alpha')
    expect(upgradeLegacyAuvikSiteLabel(
      'Site South (manual override)', raw,
      'Northwind Logistics', 'Site Alpha', 'Open Internet',
    )).toBe('Site South (manual override)')
  })

  it('preserves a site suffix when no verified Business Unit is known', () => {
    expect(inferAuvikProposalFromKnownCustomer(
      'Northwind Logistics - Site Alpha - Open Internet',
      'Northwind Logistics',
      [],
    )).toMatchObject({
      businessUnit: null, site: 'Site Alpha - Open Internet',
    })
  })

  it('keeps complete leaf proposals even if only the Customer exists canonically', () => {
    const complete = {
      customer: 'Fabrikam Outreach', businessUnit: null, site: '2345CD34', parentTenantId: null,
    }
    expect(chooseAuvikMappingSuggestion({
      customer: 'Fabrikam Outreach', businessUnit: null, site: null, status: 'CUSTOMER',
    }, complete)).toMatchObject({ site: '2345CD34' })
    expect(chooseAuvikMappingSuggestion({
      customer: 'Different customer', businessUnit: null, site: null, status: 'CUSTOMER',
    }, complete)).toMatchObject({ customer: 'Different customer', site: null })
    expect(chooseAuvikMappingSuggestion({
      customer: 'Fabrikam Outreach', businessUnit: null, site: null, status: 'REUSED',
    }, complete)).toMatchObject({ customer: 'Fabrikam Outreach', site: '2345CD34' })
  })

  it('extracts an orphaned postcode leaf only with known Customer evidence', () => {
    const orphan: AuvikTenantResource = {
      id: 'orphan', type: 'tenant',
      attributes: { domainPrefix: 'opaque', displayName: 'Fabrikam Outreach - 2345CD34', tenantType: 'client' },
    }
    expect(deriveAuvikHierarchyProposal(orphan, [orphan])).toBeNull()
    expect(inferAuvikProposalFromKnownCustomer(
      orphan.attributes.displayName!, 'Fabrikam Outreach', [],
    )).toEqual({ customer: 'Fabrikam Outreach', businessUnit: null, site: '2345CD34' })
    expect(inferAuvikProposalFromKnownCustomer(
      orphan.attributes.displayName!, 'Unrelated customer', [],
    )).toBeNull()
  })

  it('preserves postcode + house number in an existing incomplete mapping proposal', () => {
    const output = normalizeAuvikHierarchyNames(['Fabrikam Outreach - [45678]', 'Fabrikam Outreach - 1234AB12'])
    expect(output).toEqual({ customer: 'Fabrikam Outreach', businessUnit: null, site: '1234AB12' })
  })

  it('lets a naming policy disable built-in cleanup without changing raw Auvik evidence', () => {
    const output = normalizeAuvikHierarchyNames(
      ['Fabrikam Outreach - [45678]', 'Fabrikam Outreach - 1234AB12'],
      { stripAccountNumbers: false, stripRepeatedParents: false, rules: [] },
    )
    expect(output).toEqual({
      customer: 'Fabrikam Outreach - [45678]',
      businessUnit: null,
      site: 'Fabrikam Outreach - 1234AB12',
    })
  })

  it('supports explicit exact and prefix rules after default cleanup', () => {
    const policy = normalizeAuvikNamingPolicy({
      rules: [
        { id: '1', enabled: true, field: 'customer', match: 'EXACT', find: 'Fabrikam Outreach', replace: 'FBM' },
        { id: '2', enabled: true, field: 'site', match: 'EXACT', find: '1234AB12', replace: 'Postcode 1234AB12' },
      ],
    })
    expect(normalizeAuvikHierarchyNames(
      ['Fabrikam Outreach - [45678]', 'Fabrikam Outreach - 1234AB12'], policy,
    )).toEqual({ customer: 'FBM', businessUnit: null, site: 'Postcode 1234AB12' })
  })

  it('validates active rules but permits blank disabled drafts', () => {
    expect(normalizeAuvikNamingPolicy({ rules: [
      { id: 'draft', enabled: false, field: 'site', match: 'EXACT', find: '', replace: '' },
    ] }).rules).toHaveLength(1)
    expect(() => normalizeAuvikNamingPolicy({ rules: [
      { id: 'bad', enabled: true, field: 'site', match: 'EXACT', find: '', replace: '' },
    ] })).toThrow()
  })

  it('does not strip a shared fragment inside a real site name', () => {
    expect(normalizeAuvikHierarchyNames(['Adventure', 'AdventureLand - Center'])).toMatchObject({ site: 'AdventureLand - Center' })
  })
})

describe('Auvik tenant hierarchy suggestions', () => {
  it('proposes canonical hierarchy from source parent links without using domain prefixes', () => {
    const chain: AuvikTenantResource[] = [
      { id: 'msp', type: 'tenant', attributes: { domainPrefix: 'opaque-root', displayName: 'MSP', tenantType: 'multiClient' } },
      { id: 'parent', type: 'tenant', attributes: { domainPrefix: 'opaque-customer', displayName: 'Northwind', tenantType: 'multiClient' },
        relationships: { parent: { data: { id: 'msp' } } } },
      { id: 'site', type: 'tenant', attributes: { domainPrefix: 'opaque-site', displayName: 'Headquarters', tenantType: 'client' },
        relationships: { parent: { data: { id: 'parent' } } } },
    ]
    const result = deriveAuvikHierarchyProposal(chain[2], chain)
    expect(result).toEqual({ customer: 'Northwind', businessUnit: null, site: 'Headquarters', parentTenantId: 'parent' })
    expect(suggestAuvikTenantHierarchy(chain[2], [customer], result)).toMatchObject({
      customer: 'Northwind', site: 'Headquarters', status: 'CUSTOMER_AND_SITE',
    })
  })

  it('keeps the parent Customer in an abbreviated two-level Auvik path', () => {
    const parent: AuvikTenantResource = {
      id: 'parent', type: 'tenant',
      attributes: { domainPrefix: 'parent', tenantType: 'multiClient', displayName: 'Fabrikam Outreach - [45678]' },
    }
    const leaf: AuvikTenantResource = {
      id: 'leaf', type: 'tenant',
      attributes: { domainPrefix: 'opaque', tenantType: 'client', displayName: 'Fabrikam Outreach - 2345CD34' },
      relationships: { parent: { data: { id: 'parent' } } },
    }
    expect(deriveAuvikHierarchyProposal(leaf, [parent, leaf])).toEqual({
      customer: 'Fabrikam Outreach', businessUnit: null,
      site: '2345CD34', parentTenantId: 'parent',
    })
  })

  it('handles Auvik paths starting at the actual Customer instead of an MSP root', () => {
    const path: AuvikTenantResource[] = [
      { id: 'logistics', type: 'tenant', attributes: {
        domainPrefix: 'logistics', tenantType: 'multiClient', displayName: 'Northwind Logistics - [12345]',
      } },
      { id: 'unit', type: 'tenant', attributes: {
        domainPrefix: 'internet', tenantType: 'multiClient', displayName: 'Northwind Logistics - Open Internet',
      }, relationships: { parent: { data: { id: 'logistics' } } } },
      { id: 'zwolle', type: 'tenant', attributes: {
        domainPrefix: 'site', tenantType: 'client', displayName: 'Northwind Logistics - Site Alpha - Open Internet',
      }, relationships: { parent: { data: { id: 'unit' } } } },
    ]
    expect(deriveAuvikHierarchyProposal(path[2], path)).toEqual({
      customer: 'Northwind Logistics', businessUnit: 'Open Internet',
      site: 'Site Alpha', parentTenantId: 'unit',
    })
  })

  it('requires an intact parent chain and a display name', () => {
    const child: AuvikTenantResource = {
      id: 'site', type: 'tenant',
      attributes: { domainPrefix: 'opaque', tenantType: 'client', displayName: 'Office' },
      relationships: { parent: { data: { id: 'missing-parent' } } },
    }
    expect(deriveAuvikHierarchyProposal(child, [child])).toBeNull()
    expect(deriveAuvikHierarchyProposal(tenant({ domainPrefix: 'only-id', tenantType: 'client' }), [])).toBeNull()
  })

  it('matches an unambiguous customer, site, and optional business unit', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: '12345xyz', tenantType: 'client',
      clientName: ' NORTHWIND ', siteName: 'headquarters',
    }), [customer])).toEqual({
      customer: 'Northwind', businessUnit: 'Corporate', site: 'Headquarters',
      status: 'CUSTOMER_AND_SITE',
    })
  })

  it('suggests only the customer without explicit matching site evidence', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'northwind', tenantType: 'client', clientName: 'Northwind',
    }), [customer])).toEqual({
      customer: 'Northwind', businessUnit: null, site: null, status: 'CUSTOMER',
    })
  })

  it('does not mistake an opaque domain prefix for a customer', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'Northwind', tenantType: 'client',
    }), [customer])).toBeNull()
  })

  it('refuses ambiguous duplicate canonical customer names', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'unimportant', tenantType: 'client', name: 'Northwind',
    }), [customer, { ...customer, name: 'northwind' }])).toBeNull()
  })

  it('does not choose between two same-name sites', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'prefix', tenantType: 'client',
      clientName: 'Northwind', siteName: 'Warehouse',
    }), [{ ...customer, sites: [...customer.sites, { ...customer.sites[1] }] }]))
      .toMatchObject({ customer: 'Northwind', site: null, status: 'CUSTOMER' })
  })
})
