import { describe, expect, it } from 'vitest'
import { chooseAuvikMappingSuggestion, cleanAuvikHierarchyLabel, deriveAuvikHierarchyProposal, inferAuvikProposalFromKnownCustomer, normalizeAuvikHierarchyNames, normalizeAuvikNamingPolicy, suggestAuvikTenantHierarchy } from '@/lib/auvik-tenant-matching'
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
    expect(cleanAuvikHierarchyLabel('Deutsche Post DHL - [43541]')).toBe('Deutsche Post DHL')
    expect(cleanAuvikHierarchyLabel('Aqualab Zuid BV [250493]')).toBe('Aqualab Zuid BV')
    expect(cleanAuvikHierarchyLabel('Network [Lab]')).toBe('Network [Lab]')
    expect(cleanAuvikHierarchyLabel('Example - [Not a number]')).toBe('Example - [Not a number]')
  })

  it.each([
    { names: ['ROVA Holding NV - [35466]', 'Rova - Winterswijk - VK'], expected: { customer: 'ROVA Holding NV', businessUnit: null, site: 'Winterswijk - VK' } },
    { names: ['Leger des Heils - [44751]', 'Leger des Heils - 3059LG41'], expected: { customer: 'Leger des Heils', businessUnit: null, site: '3059LG41' } },
    { names: ['Stichting SWZ - [43968]', 'SWZ - WV Eindhoven - Silverenberg'], expected: { customer: 'Stichting SWZ', businessUnit: null, site: 'WV Eindhoven - Silverenberg' } },
    { names: ['Metrex - Moxba B.V. [44642]', 'Metrex - Heeren'], expected: { customer: 'Metrex - Moxba B.V.', businessUnit: null, site: 'Heeren' } },
    { names: ['Dusseldorp Automotive BV - [44358]', 'Dusseldorp Automotive - Deventer'], expected: { customer: 'Dusseldorp Automotive BV', businessUnit: null, site: 'Deventer' } },
    { names: ['Unica Groep BV - [43398]', 'Unica Groep - Gerco Applicom Nijmegen'], expected: { customer: 'Unica Groep BV', businessUnit: null, site: 'Gerco Applicom Nijmegen' } },
    { names: ['Deutsche Post DHL - [43541]', 'Deutsche Post DHL - Open Internet', 'Deutsche Post DHL - Utrecht - Reactoweg - Open Internet'], expected: { customer: 'Deutsche Post DHL', businessUnit: 'Open Internet', site: 'Utrecht - Reactoweg' } },
    { names: ['Deutsche Post DHL - [43541]', 'Deutsche Post DHL - eCom - [43541]', 'Deutsche Post DHL - eCom - Alkmaar'], expected: { customer: 'Deutsche Post DHL', businessUnit: 'eCom', site: 'Alkmaar' } },
    { names: ['Unica Groep BV - [43398]', 'Blaas Set 18 - Quintax (Apeldoorn)'], expected: { customer: 'Unica Groep BV', businessUnit: null, site: 'Blaas Set 18 - Quintax (Apeldoorn)' } },
  ])('normalizes Auvik path $names', ({ names, expected }) => {
    expect(normalizeAuvikHierarchyNames(names)).toEqual(expected)
  })

  it('maps DHL site names with a verified Business Unit suffix', () => {
    expect(normalizeAuvikHierarchyNames([
      'Deutsche Post DHL - [43541]',
      'Deutsche Post DHL - Open Internet',
      'Deutsche Post DHL - Zwolle Nieuwbouw - Open Internet',
    ])).toEqual({
      customer: 'Deutsche Post DHL', businessUnit: 'Open Internet', site: 'Zwolle Nieuwbouw',
    })
    expect(inferAuvikProposalFromKnownCustomer(
      'Deutsche Post DHL - Zwolle Nieuwbouw - Open Internet',
      'Deutsche Post DHL',
      ['Open Internet'],
    )).toEqual({
      customer: 'Deutsche Post DHL', businessUnit: 'Open Internet', site: 'Zwolle Nieuwbouw',
    })
  })

  it('preserves a site suffix when no verified Business Unit is known', () => {
    expect(inferAuvikProposalFromKnownCustomer(
      'Deutsche Post DHL - Zwolle Nieuwbouw - Open Internet',
      'Deutsche Post DHL',
      [],
    )).toMatchObject({
      businessUnit: null, site: 'Zwolle Nieuwbouw - Open Internet',
    })
  })

  it('keeps complete leaf proposals even if only the Customer exists canonically', () => {
    const complete = {
      customer: 'Leger des Heils', businessUnit: null, site: '3135VR41', parentTenantId: null,
    }
    expect(chooseAuvikMappingSuggestion({
      customer: 'Leger des Heils', businessUnit: null, site: null, status: 'CUSTOMER',
    }, complete)).toMatchObject({ site: '3135VR41' })
    expect(chooseAuvikMappingSuggestion({
      customer: 'Different customer', businessUnit: null, site: null, status: 'CUSTOMER',
    }, complete)).toMatchObject({ customer: 'Different customer', site: null })
  })

  it('extracts an orphaned postcode leaf only with known Customer evidence', () => {
    const orphan: AuvikTenantResource = {
      id: 'orphan', type: 'tenant',
      attributes: { domainPrefix: 'opaque', displayName: 'Leger des Heils - 3135VR41', tenantType: 'client' },
    }
    expect(deriveAuvikHierarchyProposal(orphan, [orphan])).toBeNull()
    expect(inferAuvikProposalFromKnownCustomer(
      orphan.attributes.displayName!, 'Leger des Heils', [],
    )).toEqual({ customer: 'Leger des Heils', businessUnit: null, site: '3135VR41' })
    expect(inferAuvikProposalFromKnownCustomer(
      orphan.attributes.displayName!, 'Unrelated customer', [],
    )).toBeNull()
  })

  it('preserves postcode + house number in an existing incomplete mapping proposal', () => {
    const output = normalizeAuvikHierarchyNames(['Leger des Heils - [44751]', 'Leger des Heils - 3059LG41'])
    expect(output).toEqual({ customer: 'Leger des Heils', businessUnit: null, site: '3059LG41' })
  })

  it('lets a naming policy disable built-in cleanup without changing raw Auvik evidence', () => {
    const output = normalizeAuvikHierarchyNames(
      ['Leger des Heils - [44751]', 'Leger des Heils - 3059LG41'],
      { stripAccountNumbers: false, stripRepeatedParents: false, rules: [] },
    )
    expect(output).toEqual({
      customer: 'Leger des Heils - [44751]',
      businessUnit: null,
      site: 'Leger des Heils - 3059LG41',
    })
  })

  it('supports explicit exact and prefix rules after default cleanup', () => {
    const policy = normalizeAuvikNamingPolicy({
      rules: [
        { id: '1', enabled: true, field: 'customer', match: 'EXACT', find: 'Leger des Heils', replace: 'LDH' },
        { id: '2', enabled: true, field: 'site', match: 'EXACT', find: '3059LG41', replace: 'Postcode 3059LG41' },
      ],
    })
    expect(normalizeAuvikHierarchyNames(
      ['Leger des Heils - [44751]', 'Leger des Heils - 3059LG41'], policy,
    )).toEqual({ customer: 'LDH', businessUnit: null, site: 'Postcode 3059LG41' })
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
    expect(normalizeAuvikHierarchyNames(['Unica', 'Unicat - Center'])).toMatchObject({ site: 'Unicat - Center' })
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
      attributes: { domainPrefix: 'parent', tenantType: 'multiClient', displayName: 'Leger des Heils - [44751]' },
    }
    const leaf: AuvikTenantResource = {
      id: 'leaf', type: 'tenant',
      attributes: { domainPrefix: 'opaque', tenantType: 'client', displayName: 'Leger des Heils - 3135VR41' },
      relationships: { parent: { data: { id: 'parent' } } },
    }
    expect(deriveAuvikHierarchyProposal(leaf, [parent, leaf])).toEqual({
      customer: 'Leger des Heils', businessUnit: null,
      site: '3135VR41', parentTenantId: 'parent',
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
