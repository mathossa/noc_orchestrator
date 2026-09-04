import { describe, expect, it } from 'vitest'
import {
  evaluateImporterV2WithFirmware,
  type ImporterV2FirmwareEvaluationInput,
} from '@/lib/importer-v2-firmware-evaluation'

function baseInput(): ImporterV2FirmwareEvaluationInput {
  return {
    profile: {
      id: 'profile-1',
      version: 'profile-v1',
      sourceAdapterId: 'auvik-xlsx',
      provider: 'Auvik',
      requiredFields: ['currentFirmware'],
      warnWhenUnresolvedFields: [],
    },
    catalog: {
      version: 'catalog-v1',
      values: {
        currentFirmware: [
          { id: 'release-17.12.05', label: '17.12.05' },
        ],
        softwarePlatform: [{ id: 'platform-ios-xe', label: 'IOS-XE' }],
      },
    },
    rules: {
      version: 'rules-v1',
      manualOverrides: [],
      rememberedMappings: [],
      profileRules: [],
    },
    parsers: { version: 'generic-parsers-v1', definitions: [] },
    suggestions: {
      version: 'suggestions-v1',
      suggestions: [
        {
          id: 'fuzzy-release-suggestion',
          field: 'currentFirmware',
          when: {
            field: 'currentFirmware',
            operator: 'CONTAINS',
            value: '17.12',
          },
          target: { id: 'release-17.12.05', label: '17.12.05' },
          confidence: 'LOW',
          explanation: 'Fuzzy release similarity.',
        },
      ],
    },
    firmwareContext: {
      compatibilityVersion: 'compat-v1',
      compatibilityRules: [
        {
          id: 'cisco-c9300',
          vendor: 'Cisco',
          model: 'C9300-24P',
          platforms: ['IOS-XE'],
        },
      ],
    },
    rows: [
      {
        rowNumber: 2,
        sourceRecordKey: 'device-1',
        rawValues: {
          customer: 'Customer A',
          deviceName: 'core-1',
          vendor: 'Cisco',
          model: 'C9300-24P',
          deviceType: 'Switch',
          firmwareVersion: '17.5(1r)',
          softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
        },
      },
    ],
  }
}

describe('Importer v2 centralized firmware evaluation boundary', () => {
  it('attaches one deterministic firmware proof to the staged row', () => {
    const result = evaluateImporterV2WithFirmware(baseInput())
    const row = result.rows[0]

    expect(row.firmware.runningVersion).toBe('17.12.05')
    expect(row.firmware.proposedSoftwarePlatform).toBe('IOS-XE')
    expect(row.fields.currentFirmware.proposedValue).toEqual({
      id: null,
      label: '17.12.05',
    })
    expect(row.fields.currentFirmware.decision).toMatchObject({
      source: 'DETERMINISTIC_PARSER',
      matchedParserId: 'importer-v2-firmware-interpreter',
      matchedParserVersion: '1.0.0',
      requiresConfirmation: true,
    })
  })

  it('never auto-links an interpreted version to an exact or fuzzy catalog release', () => {
    const input = baseInput()
    input.rows[0].rawValues.currentFirmware = '17.12.05'

    const row = evaluateImporterV2WithFirmware(input).rows[0]

    expect(row.fields.currentFirmware.proposedValue).toEqual({
      id: null,
      label: '17.12.05',
    })
    expect(row.fields.currentFirmware.decision.matchedCatalogValueId).toBeNull()
    expect(row.fields.currentFirmware.decision.matchedSuggestionId).toBeNull()
  })

  it('keeps unknown running firmware importable as a warning even when the profile previously required it', () => {
    const input = baseInput()
    input.rows[0].rawValues.firmwareVersion = '10.3.9'
    input.rows[0].rawValues.softwareVersion = 'ExampleOS 10.4.3 build 711'
    input.rows[0].rawValues.vendor = 'Example Networks'
    input.rows[0].rawValues.model = 'EX-2400'

    const row = evaluateImporterV2WithFirmware(input).rows[0]
    const firmwareIssue = row.issues.find(
      (issue) => issue.field === 'currentFirmware',
    )

    expect(row.firmware.runningVersion).toBeNull()
    expect(firmwareIssue).toMatchObject({
      severity: 'WARNING',
      code: 'OPTIONAL_FIELD_UNRESOLVED',
    })
    expect(row.issues).not.toContainEqual(
      expect.objectContaining({
        field: 'currentFirmware',
        severity: 'ERROR',
      }),
    )
    expect(row.statuses).toEqual(
      expect.arrayContaining(['WARNING', 'NEEDS_REVIEW']),
    )
  })

  it('uses the interpreted platform to satisfy a required software platform', () => {
    const input = baseInput()
    input.profile.requiredFields = ['softwarePlatform']

    const row = evaluateImporterV2WithFirmware(input).rows[0]

    expect(row.fields.softwarePlatform.proposedValue).toEqual({
      id: null,
      label: 'IOS-XE',
    })
    expect(row.issues).not.toContainEqual(
      expect.objectContaining({
        field: 'softwarePlatform',
        severity: 'ERROR',
      }),
    )
  })

  it('still blocks publication when software platform is required but cannot be determined', () => {
    const input = baseInput()
    input.profile.requiredFields = ['softwarePlatform']
    input.rows[0].rawValues.vendor = 'Unknown Vendor'
    input.rows[0].rawValues.model = 'Unknown Model'
    input.rows[0].rawValues.firmwareVersion = null
    input.rows[0].rawValues.softwareVersion = '10.4.3'

    const row = evaluateImporterV2WithFirmware(input).rows[0]

    expect(row.firmware.proposedSoftwarePlatform).toBeNull()
    expect(row.issues).toContainEqual(
      expect.objectContaining({
        field: 'softwarePlatform',
        severity: 'ERROR',
        code: 'REQUIRED_FIELD_UNRESOLVED',
      }),
    )
  })

  it('creates proof groups from included rows so one evidence pattern can be reviewed once', () => {
    const input = baseInput()
    input.rows = [
      ...input.rows,
      {
        rowNumber: 3,
        sourceRecordKey: 'device-2',
        rawValues: {
          customer: 'Customer B',
          deviceName: 'core-2',
          vendor: 'Cisco',
          model: 'C9300-24P',
          deviceType: 'Switch',
          firmwareVersion: '17.5(1r)',
          softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
        },
      },
    ]

    const result = evaluateImporterV2WithFirmware(input)

    expect(result.firmwareProofGroups).toHaveLength(1)
    expect(result.firmwareProofGroups[0]).toMatchObject({
      count: 2,
      customers: ['Customer A', 'Customer B'],
      models: ['C9300-24P'],
      requiresConfirmation: true,
    })
  })

  it('retains raw Firmware Version and Software Version unchanged beside the interpretation', () => {
    const row = evaluateImporterV2WithFirmware(baseInput()).rows[0]

    expect(row.rawValues.firmwareVersion).toBe('17.5(1r)')
    expect(row.rawValues.softwareVersion).toBe(
      'Cisco IOS XE Software, Version 17.12.05',
    )
    expect(row.firmware.rawEvidence.firmwareVersion).toBe('17.5(1r)')
    expect(row.firmware.rawEvidence.softwareVersion).toBe(
      'Cisco IOS XE Software, Version 17.12.05',
    )
  })
})
