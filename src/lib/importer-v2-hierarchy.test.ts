import { describe, expect, it } from 'vitest'
import {
  IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
  ImporterV2HierarchyTemplateError,
  parseImporterV2Hierarchy,
  validateImporterV2HierarchyTemplate,
} from '@/lib/importer-v2-hierarchy'

describe('Importer v2 hierarchy templates', () => {
  it.each([
    ['Northwind Transit', 'customer-only', 'Northwind Transit', null, null],
    [
      'Northwind Transit - Harbor Campus',
      'customer-site',
      'Northwind Transit',
      null,
      'Harbor Campus',
    ],
    [
      'Northwind Transit - eCom - Alkmaar Lab',
      'customer-business-unit-site',
      'Northwind Transit',
      'eCom',
      'Alkmaar Lab',
    ],
    [
      'Northwind Transit - Open Internet - Amersfoort - West',
      'customer-business-unit-site-with-delimiter',
      'Northwind Transit',
      'Open Internet',
      'Amersfoort - West',
    ],
  ])(
    'parses %s with the saved variant',
    (rawValue, variant, customer, businessUnit, site) => {
      const result = parseImporterV2Hierarchy(
        2,
        rawValue,
        IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
      )

      expect(result).toMatchObject({
        status: 'PARSED',
        matchedVariantId: variant,
        effectiveValues: { customer, businessUnit, site },
        issues: [],
      })
    },
  )

  it('keeps synthetic eCom and Open Internet business units separate from their sites', () => {
    const results = [
      'Contoso Logistics - eCom - Zaltbommel Hub',
      'Contoso Logistics - Open Internet - Alkmaar Campus',
    ].map((value, index) =>
      parseImporterV2Hierarchy(
        index + 2,
        value,
        IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
      ),
    )

    expect(results.map((result) => result.effectiveValues)).toEqual([
      {
        customer: 'Contoso Logistics',
        businessUnit: 'eCom',
        site: 'Zaltbommel Hub',
      },
      {
        customer: 'Contoso Logistics',
        businessUnit: 'Open Internet',
        site: 'Alkmaar Campus',
      },
    ])
  })

  it('keeps a malformed value visible until a direct row correction resolves it', () => {
    const malformed = parseImporterV2Hierarchy(
      9,
      'Contoso Logistics -  - South',
      IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
    )
    const corrected = parseImporterV2Hierarchy(
      9,
      'Contoso Logistics -  - South',
      IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
      { customer: 'Contoso Logistics', businessUnit: 'Parcel', site: 'South' },
    )

    expect(malformed).toMatchObject({
      status: 'NONCONFORMING',
      issues: [{ code: 'EMPTY_SEGMENT' }],
    })
    expect(corrected).toMatchObject({
      status: 'CORRECTED',
      effectiveValues: {
        customer: 'Contoso Logistics',
        businessUnit: 'Parcel',
        site: 'South',
      },
      issues: [{ code: 'EMPTY_SEGMENT', resolvedByCorrection: true }],
    })
  })

  it('rejects ambiguous or incomplete templates before parsing rows', () => {
    expect(() =>
      validateImporterV2HierarchyTemplate({
        id: 'bad',
        version: '1',
        delimiter: ' - ',
        variants: [
          { id: 'same', minSegments: 1, maxSegments: 1, assignments: [] },
          { id: 'same', minSegments: 1, maxSegments: 1, assignments: [] },
        ],
      }),
    ).toThrow(ImporterV2HierarchyTemplateError)
  })
})
