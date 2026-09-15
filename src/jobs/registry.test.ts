import { describe, expect, it } from 'vitest'
import { JOB_DEFINITIONS, JOB_NAMES, parseJobPayload } from './registry'

describe('background job registry', () => {
  it('registers only the harmless infrastructure demonstration job', () => {
    expect(JOB_NAMES).toEqual(['example.some-job'])
    expect(JOB_NAMES.some((name) => name.includes('firmware-execution'))).toBe(false)
  })

  it('validates the versioned demonstration payload', () => {
    expect(
      parseJobPayload('example.some-job', { version: 1, marker: 'integration' }),
    ).toEqual({ version: 1, marker: 'integration' })

    expect(() =>
      parseJobPayload('example.some-job', { version: 2, marker: 'integration' }),
    ).toThrow('Invalid payload for example.some-job')
  })

  it('uses pg-boss queue retry, expiry, retention, and uniqueness primitives', () => {
    expect(JOB_DEFINITIONS['example.some-job'].queue).toMatchObject({
      policy: 'exclusive',
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      expireInSeconds: 60,
    })
  })
})
