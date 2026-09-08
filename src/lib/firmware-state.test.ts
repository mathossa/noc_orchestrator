import { describe, expect, it } from 'vitest'
import { resolveTechnicalFirmwareState } from './firmware-state'
import { result } from './test-fixtures/firmware-compliance'
import type { FirmwareCompliance, FirmwareRecommendation } from './firmware-compliance'

describe('legacy summaries delegate to compliance', () => {
  it.each<[FirmwareCompliance, FirmwareRecommendation, string]>([
    ['PREFERRED', 'NO_ACTION', 'CURRENT'], ['ACCEPTED', 'NO_ACTION', 'CURRENT'],
    ['ACCEPTED', 'UPDATE_RECOMMENDED', 'ACTION_REQUIRED'], ['BELOW_MINIMUM', 'UPDATE_REQUIRED', 'ACTION_REQUIRED'],
    ['OUTSIDE_RANGE', 'PLATFORM_MIGRATION', 'ACTION_REQUIRED'], ['BLOCKED_RELEASE', 'REVIEW_REQUIRED', 'ACTION_REQUIRED'],
    ['NOT_COMPARABLE', 'REVIEW_REQUIRED', 'ACTION_REQUIRED'], ['INCOMPATIBLE', 'REVIEW_REQUIRED', 'ACTION_REQUIRED'],
    ['UNKNOWN_FIRMWARE', 'REVIEW_REQUIRED', 'UNKNOWN'], ['NO_POLICY', 'REVIEW_REQUIRED', 'NO_POLICY'],
  ])('%s / %s projects to %s', (compliance, recommendation, expected) => {
    expect(resolveTechnicalFirmwareState(result({ compliance, recommendation }))).toBe(expected)
  })
})
