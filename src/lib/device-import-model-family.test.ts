import { describe, expect, it } from 'vitest'
import { suggestImportModelFamily } from '@/lib/device-import-model-family'

const families = [
  { id: '2530', vendorId: 'aruba', name: '2530', isActive: true },
  { id: '100f', vendorId: 'fortinet', name: 'FortiGate 100F', isActive: true },
  { id: '100', vendorId: 'fortinet', name: 'FortiGate 100', isActive: true },
]

describe('suggestImportModelFamily', () => {
  it('suggests a numeric series contained in the model notation', () => {
    expect(suggestImportModelFamily('Aruba 2530-24G-PoE+', 'aruba', families)?.id).toBe('2530')
  })

  it('prefers the most specific matching family', () => {
    expect(suggestImportModelFamily('Fortinet FortiGate-100F', 'fortinet', families)?.id).toBe('100f')
  })

  it('does not cross vendor boundaries or guess unrelated families', () => {
    expect(suggestImportModelFamily('Aruba 2530-24G', 'fortinet', families)).toBeNull()
    expect(suggestImportModelFamily('Cisco C9300-48P', 'aruba', families)).toBeNull()
  })
})
