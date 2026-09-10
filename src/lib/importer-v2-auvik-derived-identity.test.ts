import { describe, expect, it } from 'vitest'
import {
  importerV2AuvikContextSupportsExistingDevice,
  importerV2DerivedAuvikDeviceSourceId,
  isImporterV2AuvikXlsxSource,
} from '@/lib/importer-v2-auvik-derived-identity'

describe('Importer v2 Auvik derived device identity', () => {
  it('only enables the fallback for Auvik XLSX sources', () => {
    expect(
      isImporterV2AuvikXlsxSource({ provider: 'Auvik', sourceAdapterId: 'xlsx' }),
    ).toBe(true)
    expect(
      isImporterV2AuvikXlsxSource({ provider: 'Auvik', sourceAdapterId: 'api-v1' }),
    ).toBe(false)
    expect(
      isImporterV2AuvikXlsxSource({ provider: 'Other', sourceAdapterId: 'xlsx' }),
    ).toBe(false)
  })

  it('derives the same key from normalized customer and device name', () => {
    const left = importerV2DerivedAuvikDeviceSourceId({
      provider: 'Auvik',
      customer: 'Stichting Sprank',
      deviceName: '1-AP-27',
    })
    const right = importerV2DerivedAuvikDeviceSourceId({
      provider: ' auvik ',
      customer: '  stichting   sprank ',
      deviceName: '1-ap-27',
    })

    expect(left).toBe(right)
    expect(left).toMatch(/^derived-auvik-device:[0-9a-f]{32}$/)
  })

  it('does not change identity when the device moves sites', () => {
    const before = importerV2DerivedAuvikDeviceSourceId({
      provider: 'Auvik',
      customer: 'Stichting Sprank',
      deviceName: '1-AP-27',
    })
    const after = importerV2DerivedAuvikDeviceSourceId({
      provider: 'Auvik',
      customer: 'Stichting Sprank',
      deviceName: '1-AP-27',
    })

    expect(after).toBe(before)
  })

  it('requires site or model agreement before bootstrapping an existing device', () => {
    expect(
      importerV2AuvikContextSupportsExistingDevice({
        sourceSite: 'Vlasakkerstaete 1 Hardenberg',
        candidateSite: 'Vlasakkerstaete 1 Hardenberg',
        sourceModel: 'Aruba AP-205H',
        candidateModel: 'Aruba AP-205H',
      }),
    ).toBe(true)

    expect(
      importerV2AuvikContextSupportsExistingDevice({
        sourceSite: 'Different site',
        candidateSite: 'Vlasakkerstaete 1 Hardenberg',
        sourceModel: 'Different model',
        candidateModel: 'Aruba AP-205H',
      }),
    ).toBe(false)
  })
})
