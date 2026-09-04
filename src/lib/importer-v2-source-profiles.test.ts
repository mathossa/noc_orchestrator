import { describe, expect, it } from 'vitest'
import { IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE } from '@/lib/importer-v2-hierarchy'
import {
  applyImporterV2ProfileOverrides,
  buildImporterV2SourceProfile,
  importerV2SchemaFingerprint,
  ImporterV2SourceProfileError,
  recognizeImporterV2SourceProfile,
  type ImporterV2ObservedSourceSchema,
} from '@/lib/importer-v2-source-profiles'

const observed: ImporterV2ObservedSourceSchema = {
  fileName: 'Devices - 3.xlsx',
  provider: 'SyntheticCMDB',
  sourceAdapterId: 'xlsx-tabular-v1',
  sheetName: 'Inventory',
  headerRow: 3,
  headers: ['Organization', 'Device ID', 'Device Type'],
  columnMappings: [
    { columnIndex: 0, sourceHeader: 'Organization', targetField: 'customer' },
    { columnIndex: 1, sourceHeader: 'Device ID', targetField: 'sourceId' },
    { columnIndex: 2, sourceHeader: 'Device Type', targetField: 'deviceType' },
  ],
}

function profile(id = 'profile-1', name = 'Synthetic inventory') {
  return buildImporterV2SourceProfile({
    id,
    name,
    version: '1',
    isActive: true,
    provider: observed.provider,
    sourceAdapterId: observed.sourceAdapterId,
    sheetName: observed.sheetName,
    headerRow: observed.headerRow,
    headers: observed.headers,
    columnMappings: observed.columnMappings,
    hierarchyTemplate: IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
    deviceTypePolicy: { version: '1', defaultAction: 'INCLUDE', rules: [] },
    defaults: { vendor: 'Example Networks' },
    exactValueAliases: [],
  })
}

describe('Importer v2 source-profile recognition', () => {
  it('ignores workbook filename and normalizes header case and whitespace in the fingerprint', () => {
    const renamed = {
      ...observed,
      fileName: 'Devices - 4.xlsx',
      headers: [' organization ', 'DEVICE   ID', 'device type'],
      columnMappings: observed.columnMappings.map((mapping) => ({
        ...mapping,
        sourceHeader: ` ${mapping.sourceHeader.toUpperCase()} `,
      })),
    }

    expect(importerV2SchemaFingerprint(renamed)).toBe(
      importerV2SchemaFingerprint(observed),
    )
    expect(
      recognizeImporterV2SourceProfile(renamed, [profile()]),
    ).toMatchObject({
      action: 'CONFIRM_PROFILE',
      suggestedProfileId: 'profile-1',
      requiresConfirmation: true,
      candidates: [{ score: 100, match: 'EXACT_SCHEMA' }],
    })
  })

  it('scores provider, adapter, headers, mappings, and worksheet evidence transparently', () => {
    const changed = {
      ...observed,
      sheetName: 'Export',
      columnMappings: observed.columnMappings.slice(0, 2),
    }
    const result = recognizeImporterV2SourceProfile(changed, [profile()])

    expect(result).toMatchObject({
      action: 'CONFIRM_PROFILE',
      requiresConfirmation: true,
    })
    expect(result.candidates[0]).toMatchObject({
      score: 70,
      match: 'COMPATIBLE_SCHEMA',
      warnings: [
        'Mapped column signature differs.',
        'Worksheet name or header row differs.',
      ],
    })
  })

  it('requires choosing when equally strong profiles match and honors an explicit selection', () => {
    const profiles = [
      profile('profile-a', 'Alpha'),
      profile('profile-b', 'Beta'),
    ]

    expect(recognizeImporterV2SourceProfile(observed, profiles)).toMatchObject({
      action: 'CHOOSE_PROFILE',
      suggestedProfileId: null,
      requiresConfirmation: true,
    })
    const selected = recognizeImporterV2SourceProfile(
      observed,
      profiles,
      'profile-b',
    )
    expect(selected).toMatchObject({
      action: 'CONFIRM_PROFILE',
      suggestedProfileId: 'profile-b',
      requiresConfirmation: true,
    })
    expect(selected.candidates[0]).toMatchObject({
      profileId: 'profile-b',
      match: 'EXPLICIT_SELECTION',
    })
  })

  it('proposes a new profile when no active profile fits', () => {
    const result = recognizeImporterV2SourceProfile(
      {
        ...observed,
        provider: 'Other source',
        sourceAdapterId: 'other-adapter',
      },
      [profile(), { ...profile('inactive'), isActive: false }],
    )

    expect(result).toMatchObject({
      action: 'CREATE_PROFILE',
      suggestedProfileId: null,
      requiresConfirmation: true,
    })
  })

  it('applies manual mapping and profile overrides without mutating the saved profile', () => {
    const saved = profile()
    const original = structuredClone(saved)
    const mappings = [
      {
        columnIndex: 0,
        sourceHeader: 'Organization',
        targetField: 'site' as const,
      },
      ...saved.columnMappings.slice(1),
    ]
    const result = applyImporterV2ProfileOverrides(saved, {
      columnMappings: mappings,
      defaults: { vendor: 'Contoso Networks' },
    })

    expect(saved).toEqual(original)
    expect(result.overriddenFields).toEqual(['columnMappings', 'defaults'])
    expect(result.profile.columnMappings).toEqual(mappings)
    expect(result.profile.schemaFingerprint).not.toBe(saved.schemaFingerprint)
  })

  it('rejects invalid mapping structures before fingerprinting', () => {
    expect(() =>
      importerV2SchemaFingerprint({
        ...observed,
        columnMappings: [
          {
            columnIndex: 0,
            sourceHeader: 'Organization',
            targetField: 'customer',
          },
          { columnIndex: 0, sourceHeader: 'Organization', targetField: 'site' },
        ],
      }),
    ).toThrow(ImporterV2SourceProfileError)
  })
})
