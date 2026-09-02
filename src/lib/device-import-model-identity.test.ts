import { describe, expect, it } from 'vitest'
import { inferImportedModelVendor, resolveImportedModelVendor } from '@/lib/device-import-model-identity'

const vendors = [
  { id: 'aruba', name: 'Aruba', code: 'ARUBA', isActive: true },
  { id: 'cisco', name: 'Cisco', code: 'CISCO', isActive: true },
  { id: 'hp', name: 'HP', code: 'HP', isActive: true },
]

describe('imported model vendor inference', () => {
  it('prefills Aruba from an imported model identity', () => {
    expect(inferImportedModelVendor('Aruba 7005', vendors)?.id).toBe('aruba')
  })

  it('accepts a configured vendor code as a delimited prefix', () => {
    expect(inferImportedModelVendor('CISCO-C9300-24P', vendors)?.id).toBe('cisco')
  })

  it('does not infer a vendor from an embedded or unknown word', () => {
    expect(inferImportedModelVendor('My Aruba 7005', vendors)).toBeNull()
    expect(inferImportedModelVendor('Aerohive AP305', vendors)).toBeNull()
  })

  it('prefers a remembered Aruba to HPE Networking mapping over the literal Aruba vendor', () => {
    const withHpe = [...vendors, { id: 'hpe', name: 'HPE Networking', code: 'HPE', isActive: true }]
    const resolution = resolveImportedModelVendor('Aruba 7005', withHpe, [{ sourceValue: 'Aruba', targetId: 'hpe' }])
    expect(resolution).toEqual({ sourceValue: 'Aruba', vendor: withHpe[3] })
  })
})
