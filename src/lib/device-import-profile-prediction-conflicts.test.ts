import { describe, expect, it } from 'vitest'
import {
  applyDeviceImportPredictionRules,
  type DeviceImportPredictionRule,
} from '@/lib/device-import-profile-predictions'

function rule(
  id: string,
  priority: number,
  result: Record<string, unknown>,
): DeviceImportPredictionRule {
  return {
    id,
    action: 'PREDICT',
    field: 'model',
    operator: 'PREFIX',
    value: 'C9300',
    normalizedValue: 'c9300',
    result,
    priority,
    isActive: true,
  }
}

describe('deterministic import prediction decisions', () => {
  it('uses higher priority for single-valued outputs regardless of input order', () => {
    const high = rule('high', 900, { preferredSoftwarePlatform: 'IOS-XE' })
    const low = rule('low', 100, { preferredSoftwarePlatform: 'IOS' })

    const forward = applyDeviceImportPredictionRules(
      { model: 'C9300-24P' },
      [low, high],
    )
    const reversed = applyDeviceImportPredictionRules(
      { model: 'C9300-24P' },
      [high, low],
    )

    expect(forward.prediction.preferredSoftwarePlatform).toBe('IOS-XE')
    expect(reversed.prediction.preferredSoftwarePlatform).toBe('IOS-XE')
    expect('conflicts' in forward).toBe(false)
    expect('conflicts' in reversed).toBe(false)
  })

  it('does not silently choose between conflicting equal-priority decisions', () => {
    const result = applyDeviceImportPredictionRules(
      { model: 'C9300-24P' },
      [
        rule('ios-xe', 500, { preferredSoftwarePlatform: 'IOS-XE' }),
        rule('ios', 500, { preferredSoftwarePlatform: 'IOS' }),
      ],
    )

    expect(result.prediction.preferredSoftwarePlatform).toBeUndefined()
    expect('conflicts' in result ? result.conflicts : undefined).toEqual([
      {
        field: 'preferredSoftwarePlatform',
        priority: 500,
        ruleIds: ['ios', 'ios-xe'],
        values: ['IOS', 'IOS-XE'],
      },
    ])
  })

  it('collects supported platforms because that output is intentionally multi-valued', () => {
    const result = applyDeviceImportPredictionRules(
      { model: 'AP-315' },
      [
        {
          ...rule('aos-10', 500, { softwarePlatforms: ['AOS-10'] }),
          value: 'AP-',
          normalizedValue: 'ap-',
        },
        {
          ...rule('aos-8', 500, { softwarePlatforms: ['AOS-8'] }),
          value: 'AP-',
          normalizedValue: 'ap-',
        },
      ],
    )

    expect(result.prediction.softwarePlatforms).toEqual(['AOS-10', 'AOS-8'])
  })
})
