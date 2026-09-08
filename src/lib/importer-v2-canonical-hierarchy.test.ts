import { describe, expect, it } from 'vitest'
import {
  resolveCanonicalHierarchy,
  type HierarchyCatalog,
} from './importer-v2-canonical-hierarchy'
const entity = { source: 'MANUAL', isActive: true }
const catalog: HierarchyCatalog = {
  customers: [
    { ...entity, id: 'c', name: 'Example' },
    { ...entity, id: 'other', name: 'Other' },
  ],
  organizationUnits: ['East', 'West'].map((name) => ({
    ...entity,
    id: name,
    name,
    customerId: 'c',
    parentId: null,
  })),
  sites: ['East', 'West', null].map((unit) => ({
    ...entity,
    id: `site-${unit}`,
    name: 'Springfield',
    customerId: 'c',
    organizationUnitId: unit,
  })),
}
const input = {
  customer: { label: 'Example' },
  businessUnit: { label: 'East' },
  site: { label: 'Springfield' },
}
describe('canonical hierarchy publication preview', () => {
  it('resolves same-named sites using the exact customer/unit context', () => {
    expect(resolveCanonicalHierarchy(input, catalog)).toMatchObject({
      ready: true,
      organizationUnit: { id: 'East' },
      site: { id: 'site-East' },
    })
    expect(
      resolveCanonicalHierarchy(
        { ...input, businessUnit: { label: 'West' } },
        catalog,
      ).site.id,
    ).toBe('site-West')
  })
  it('supports ungrouped sites and customers without units', () => {
    expect(
      resolveCanonicalHierarchy(
        { ...input, businessUnit: null },
        { ...catalog, organizationUnits: [] },
      ),
    ).toMatchObject({
      ready: true,
      organizationUnit: { status: 'ABSENT' },
      site: { id: 'site-null' },
    })
  })
  it('leaves an unknown unit unresolved without falling back to an ungrouped site', () => {
    expect(
      resolveCanonicalHierarchy(
        { ...input, businessUnit: { label: 'Unknown' } },
        catalog,
      ),
    ).toMatchObject({
      ready: false,
      organizationUnit: { status: 'UNRESOLVED' },
      site: { id: null },
    })
  })
  it('rejects explicit links across customers and units', () => {
    expect(
      resolveCanonicalHierarchy(
        {
          ...input,
          customer: { id: 'other', label: 'Other' },
          businessUnit: { id: 'East', label: 'East' },
        },
        catalog,
      ),
    ).toMatchObject({ ready: false, organizationUnit: { status: 'INVALID' } })
    expect(
      resolveCanonicalHierarchy(
        { ...input, site: { id: 'site-West', label: 'Springfield' } },
        catalog,
      ).site.status,
    ).toBe('INVALID')
  })
  it('uses strong provider identity before names and never falls back from an unknown external ID', () => {
    const sourceCatalog = {
      ...catalog,
      sites: catalog.sites.map((site) => ({
        ...site,
        externalProvider: 'test',
        externalId: site.id,
      })),
    }
    expect(
      resolveCanonicalHierarchy(
        {
          ...input,
          site: {
            label: 'Different source label',
            externalProvider: 'test',
            externalId: 'site-East',
          },
        },
        sourceCatalog,
      ).site.id,
    ).toBe('site-East')
    expect(
      resolveCanonicalHierarchy(
        {
          ...input,
          site: {
            label: 'Springfield',
            externalProvider: 'test',
            externalId: 'missing',
          },
        },
        sourceCatalog,
      ).ready,
    ).toBe(false)
  })
  it('preserves canonical manual values and exact source evidence', () => {
    const before = JSON.stringify(catalog)
    const result = resolveCanonicalHierarchy(input, catalog)
    expect(result.organizationUnit.preserveCanonicalValues).toBe(true)
    expect(result.sourceEvidence).toEqual(input)
    expect(JSON.stringify(catalog)).toBe(before)
  })
  it('requires review for inactive and ambiguous units', () => {
    expect(
      resolveCanonicalHierarchy(input, {
        ...catalog,
        organizationUnits: catalog.organizationUnits.map((unit) => ({
          ...unit,
          isActive: false,
        })),
      }).ready,
    ).toBe(false)
    expect(
      resolveCanonicalHierarchy(input, {
        ...catalog,
        organizationUnits: [
          ...catalog.organizationUnits,
          { ...catalog.organizationUnits[0], id: 'duplicate' },
        ],
      }).organizationUnit.status,
    ).toBe('UNRESOLVED')
  })
})
