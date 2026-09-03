import { describe, expect, it } from 'vitest'
import {
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
})
