import { describe, expect, it } from 'vitest'
import {
  applyDeviceImportModelTransforms,
  applyDeviceImportPredictionRules,
  importPredictionRuleMatches,
  type DeviceImportPredictionRule,
} from '@/lib/device-import-profile-predictions'

function rule(
  values: Partial<DeviceImportPredictionRule>,
): DeviceImportPredictionRule {
  return {
    id: 'rule-1',
    action: 'PREDICT',
    field: 'vendor',
    operator: 'EQUALS',
    value: 'Aruba',
    normalizedValue: 'aruba',
    result: { vendorTargetId: 'vendor-hpe' },
    priority: 500,
    isActive: true,
    ...values,
  }
}

describe('device import profile predictions', () => {
  it('matches equals, prefix and contains conditions', () => {
    expect(importPredictionRuleMatches(rule({}), { vendor: 'ARUBA' })).toBe(
      true,
    )
    expect(
      importPredictionRuleMatches(
        rule({ field: 'model', operator: 'PREFIX', normalizedValue: 'c9300' }),
        { model: 'C9300-24P' },
      ),
    ).toBe(true)
    expect(
      importPredictionRuleMatches(
        rule({
          field: 'model',
          operator: 'CONTAINS',
          normalizedValue: 'fortigate',
        }),
        { model: 'Fortinet FortiGate-100F' },
      ),
    ).toBe(true)
  })

  it('combines outputs while preserving higher-priority decisions', () => {
    const result = applyDeviceImportPredictionRules(
      { vendor: 'Aruba', model: 'AP-515' },
      [
        rule({ id: 'vendor', priority: 1_000 }),
        rule({
          id: 'wlan',
          field: 'model',
          operator: 'PREFIX',
          normalizedValue: 'ap-',
          result: {
            vendorTargetId: 'vendor-wrong',
            productFamilyId: 'family-wlan',
            softwarePlatforms: ['AOS-10'],
          },
          priority: 500,
        }),
      ],
    )
    expect(result).toEqual({
      prediction: {
        vendorTargetId: 'vendor-hpe',
        productFamilyId: 'family-wlan',
        softwarePlatforms: ['AOS-10'],
      },
      matchedRuleIds: ['vendor', 'wlan'],
    })
  })

  it('removes a configured Model prefix without damaging the hardware name', () => {
    expect(
      applyDeviceImportModelTransforms('HP 2930F VSF', [
        { operation: 'REMOVE_PREFIX', value: 'HP' },
      ]),
    ).toBe('2930F VSF')
    expect(
      applyDeviceImportModelTransforms('HPE Aruba 2930F', [
        { operation: 'REMOVE_PREFIX', value: 'HP' },
      ]),
    ).toBe('HPE Aruba 2930F')
  })

  it('returns Vendor and Model cleanup outputs from the same rule', () => {
    const applied = applyDeviceImportPredictionRules(
      { model: 'HP 2930F VSF' },
      [
        rule({
          field: 'model',
          operator: 'CONTAINS',
          normalizedValue: 'hp',
          result: {
            vendorTargetId: 'vendor-hpe',
            modelTransforms: [{ operation: 'REMOVE_PREFIX', value: 'HP' }],
          },
        }),
      ],
    )
    expect(applied.prediction).toEqual({
      vendorTargetId: 'vendor-hpe',
      modelTransforms: [{ operation: 'REMOVE_PREFIX', value: 'HP' }],
    })
    expect(
      applyDeviceImportModelTransforms(
        'HP 2930F VSF',
        applied.prediction.modelTransforms,
      ),
    ).toBe('2930F VSF')
  })

  it('supports explicit case-insensitive Model text replacement', () => {
    expect(
      applyDeviceImportModelTransforms('Aruba JL256A Switch', [
        { operation: 'REPLACE', value: ' switch', replacement: '' },
      ]),
    ).toBe('Aruba JL256A')
  })
})
