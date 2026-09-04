import { describe, expect, it } from 'vitest'
import { IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE } from '@/lib/importer-v2-hierarchy'
import {
  evaluateImporterV2DeviceType,
  previewImporterV2Profile,
  type ImporterV2DeviceTypePolicy,
} from '@/lib/importer-v2-profile-preview'

const policy: ImporterV2DeviceTypePolicy = {
  version: '1',
  defaultAction: 'INCLUDE',
  rules: [
    {
      id: 'exclude-endpoints',
      sourceValues: ['Workstation', 'Printer'],
      action: 'EXCLUDE',
      explanation: 'The confirmed network profile excludes endpoint inventory.',
    },
    {
      id: 'include-switches',
      sourceValues: ['Switch'],
      action: 'INCLUDE',
      explanation: 'The confirmed network profile includes switches.',
    },
  ],
}

describe('Importer v2 profile preview', () => {
  it('only excludes a source type through a visible, remembered profile rule', () => {
    expect(evaluateImporterV2DeviceType('Printer', policy)).toMatchObject({
      action: 'EXCLUDE',
      source: 'PROFILE_RULE',
      matchedRuleIds: ['exclude-endpoints'],
    })
    expect(evaluateImporterV2DeviceType('Phone', policy)).toMatchObject({
      action: 'INCLUDE',
      source: 'DEFAULT_POLICY',
      matchedRuleIds: [],
    })
  })

  it.each(['Unknown', 'Generic Device', '  ', null])(
    'sends %s to review without excluding unrelated rows',
    (value) => {
      expect(evaluateImporterV2DeviceType(value, policy)).toMatchObject({
        action: 'REVIEW',
        source: 'UNKNOWN_TYPE',
      })
    },
  )

  it('reports included, excluded, review, nonconforming, and bounded sample rows', () => {
    const preview = previewImporterV2Profile(
      [
        {
          rowNumber: 2,
          organizationValue: 'Contoso - eCom - North',
          deviceType: 'Switch',
        },
        {
          rowNumber: 3,
          organizationValue: 'Contoso - eCom - South',
          deviceType: 'Printer',
        },
        {
          rowNumber: 4,
          organizationValue: 'Contoso - Open Internet - West',
          deviceType: 'Unknown',
        },
        {
          rowNumber: 5,
          organizationValue: 'Contoso -  - East',
          deviceType: 'Switch',
        },
      ],
      IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
      policy,
      1,
    )

    expect(preview.counts).toEqual({
      total: 4,
      included: 1,
      excluded: 1,
      review: 2,
      nonconformingHierarchy: 1,
    })
    expect(preview.rows).toHaveLength(4)
    expect(preview.samples).toMatchObject({
      included: [{ rowNumber: 2 }],
      excluded: [{ rowNumber: 3 }],
      review: [{ rowNumber: 4 }],
    })
    expect(preview.rows[1].explanation).toContain('exclude-endpoints')
    expect(preview.rows[3]).toMatchObject({
      status: 'REVIEW',
      hierarchy: { status: 'NONCONFORMING' },
    })
  })

  it('shows a direct hierarchy correction in the same preview', () => {
    const preview = previewImporterV2Profile(
      [
        {
          rowNumber: 5,
          organizationValue: 'Contoso -  - East',
          deviceType: 'Switch',
          hierarchyCorrection: {
            customer: 'Contoso',
            businessUnit: 'eCom',
            site: 'East',
          },
        },
      ],
      IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
      policy,
    )

    expect(preview.rows[0]).toMatchObject({
      status: 'INCLUDED',
      hierarchy: {
        status: 'CORRECTED',
        effectiveValues: {
          customer: 'Contoso',
          businessUnit: 'eCom',
          site: 'East',
        },
      },
    })
  })

  it('requires review when overlapping type rules disagree', () => {
    const decision = evaluateImporterV2DeviceType('Switch', {
      ...policy,
      rules: [
        ...policy.rules,
        {
          id: 'exclude-switch',
          sourceValues: ['Switch'],
          action: 'EXCLUDE',
          explanation: 'Conflict.',
        },
      ],
    })

    expect(decision).toMatchObject({
      action: 'REVIEW',
      source: 'RULE_CONFLICT',
      matchedRuleIds: ['exclude-switch', 'include-switches'],
    })
  })
})
