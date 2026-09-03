import { describe, expect, it } from 'vitest'
import {
  canonicalImportModelIdentity,
  isSafeExistingModelPrediction,
} from '@/lib/device-import-model-predictions'

describe('device import Model predictions', () => {
  it.each([
    ['Fortinet FortiGate-100F', '100F'],
    ['Fortinet Fortigate 70G', 'FG-70G'],
    ['FortiSwitch FS-124F', '124F'],
    ['Cisco C9300-24P', 'C9300-24P'],
    ['HPE Aruba 2530-48G', '2530-48G'],
  ])('accepts equivalent hardware identities: %s -> %s', (source, target) => {
    expect(isSafeExistingModelPrediction(source, target)).toBe(true)
  })

  it.each([
    ['Fortinet FortiGate-70G', '70F'],
    ['Fortinet FortiGate-100F', '101F'],
    ['Cisco C9300-24P', 'C9300-48P'],
    ['Aruba AP-315', 'AP-515'],
  ])(
    'does not preselect a different hardware Model: %s -> %s',
    (source, target) => {
      expect(isSafeExistingModelPrediction(source, target)).toBe(false)
    },
  )

  it('keeps the meaningful hardware suffix', () => {
    expect(canonicalImportModelIdentity('Fortinet FortiGate-120G')).toBe('120g')
  })
})
