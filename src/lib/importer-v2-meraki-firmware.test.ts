import { describe, expect, it } from 'vitest'
import {
  evaluateImporterV2WithFirmware,
  type ImporterV2FirmwareEvaluationInput,
} from '@/lib/importer-v2-firmware-evaluation'

function input(): ImporterV2FirmwareEvaluationInput {
  return {
    profile: {
      id: 'auvik-profile',
      version: '1',
      sourceAdapterId: 'xlsx',
      provider: 'Auvik',
      requiredFields: ['vendor', 'model', 'deviceType'],
      warnWhenUnresolvedFields: ['softwarePlatform', 'currentFirmware'],
    },
    catalog: {
      version: 'catalog-1',
      values: {
        vendor: [{ id: 'vendor-cisco', label: 'Cisco' }],
        model: [{ id: 'model-cw9162i', label: 'Meraki CW9162I' }],
        deviceType: [{ id: 'type-ap', label: 'Access Point' }],
      },
    },
    rules: {
      version: 'rules-1',
      manualOverrides: [],
      rememberedMappings: [],
      profileRules: [],
    },
    parsers: { version: 'generic-parsers-v1', definitions: [] },
    suggestions: { version: 'suggestions-v1', suggestions: [] },
    firmwareContext: {
      compatibilityVersion: 'catalog-compatibility-1',
      compatibilityRules: [],
    },
    rows: [
      {
        rowNumber: 2,
        sourceRecordKey: 'Q5AA-M6G4-SQJE',
        rawValues: {
          customer: 'Leger des Heils',
          site: '1011SX2',
          deviceName: '1011SX2-AP047',
          serialNumber: 'Q5AA-M6G4-SQJE',
          vendor: 'Cisco',
          model: 'Meraki CW9162I',
          deviceType: 'Access Point',
          firmwareVersion: null,
          softwareVersion: 'MR 32.2.4',
        },
      },
    ],
  }
}

describe('Importer v2 Meraki firmware evaluation', () => {
  it('turns MR 32.2.4 into a compatible canonical observed release proposal', () => {
    const row = evaluateImporterV2WithFirmware(input()).rows[0]

    expect(row.firmware.runningVersion).toBe('32.2.4')
    expect(row.firmware.proposedSoftwarePlatform).toBe('Meraki MR')
    expect(row.firmware.platformEvidence).toBe('VERSION_EVIDENCE')
    expect(row.firmware.compatibility.status).toBe('COMPATIBLE')
    expect(row.firmware.rawEvidence.softwarePlatform).toBeNull()
    expect(row.firmware.rawEvidence.softwareVersion).toBe('MR 32.2.4')
    expect(row.proposedCanonicalValues.currentFirmware).toEqual({
      id: null,
      label: '32.2.4',
    })
    expect(row.proposedCanonicalValues.softwarePlatform).toEqual({
      id: null,
      label: 'Meraki MR',
    })
  })
})
