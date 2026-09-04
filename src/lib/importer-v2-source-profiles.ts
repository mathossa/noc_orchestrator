import { createHash } from 'node:crypto'
import type {
  ImporterV2Field,
  ImporterV2ProposedValue,
} from '@/lib/importer-v2-evaluator'
import type { ImporterV2HierarchyTemplate } from '@/lib/importer-v2-hierarchy'
import type { ImporterV2DeviceTypePolicy } from '@/lib/importer-v2-profile-preview'

export type ImporterV2ColumnMapping = {
  columnIndex: number
  sourceHeader: string
  targetField: ImporterV2Field
}

export type ImporterV2ObservedSourceSchema = {
  fileName?: string | null
  provider: string
  sourceAdapterId: string
  sheetName: string
  headerRow: number
  headers: readonly string[]
  columnMappings: readonly ImporterV2ColumnMapping[]
}

export type ImporterV2ExactValueAlias = {
  id: string
  field: ImporterV2Field
  normalizedInput: string
  target: ImporterV2ProposedValue
}

export type ImporterV2SourceProfile = {
  id: string
  name: string
  version: string
  isActive: boolean
  schemaFingerprint: string
  provider: string
  sourceAdapterId: string
  sheetName: string
  headerRow: number
  headers: readonly string[]
  columnMappings: readonly ImporterV2ColumnMapping[]
  hierarchyTemplate: ImporterV2HierarchyTemplate
  deviceTypePolicy: ImporterV2DeviceTypePolicy
  defaults: Partial<Record<ImporterV2Field, string>>
  exactValueAliases: readonly ImporterV2ExactValueAlias[]
}

export type ImporterV2ProfileOverride = Partial<
  Pick<
    ImporterV2SourceProfile,
    | 'sheetName'
    | 'headerRow'
    | 'headers'
    | 'columnMappings'
    | 'hierarchyTemplate'
    | 'deviceTypePolicy'
    | 'defaults'
    | 'exactValueAliases'
  >
>

export type ImporterV2EffectiveSourceProfile = {
  profile: ImporterV2SourceProfile
  overriddenFields: readonly (keyof ImporterV2ProfileOverride)[]
}

export type ImporterV2ProfileCandidate = {
  profileId: string
  profileName: string
  profileVersion: string
  score: number
  match: 'EXACT_SCHEMA' | 'COMPATIBLE_SCHEMA' | 'EXPLICIT_SELECTION'
  reasons: readonly string[]
  warnings: readonly string[]
}

export type ImporterV2ProfileRecognition = {
  schemaFingerprint: string
  action: 'CONFIRM_PROFILE' | 'CHOOSE_PROFILE' | 'CREATE_PROFILE'
  suggestedProfileId: string | null
  requiresConfirmation: true
  candidates: readonly ImporterV2ProfileCandidate[]
  errors: readonly string[]
}

export class ImporterV2SourceProfileError extends Error {
  constructor(readonly errors: readonly string[]) {
    super('The source profile is invalid.')
    this.name = 'ImporterV2SourceProfileError'
  }
}

function normalize(value: string | null | undefined) {
  if (value === null || value === undefined) return ''
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

function hash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function normalizedMappings(mappings: readonly ImporterV2ColumnMapping[]) {
  return mappings
    .map((mapping) => ({
      columnIndex: mapping.columnIndex,
      sourceHeader: normalize(mapping.sourceHeader),
      targetField: mapping.targetField,
    }))
    .toSorted(
      (left, right) =>
        left.columnIndex - right.columnIndex ||
        left.targetField.localeCompare(right.targetField),
    )
}

function normalizedSchema(schema: ImporterV2ObservedSourceSchema) {
  return {
    provider: normalize(schema.provider),
    sourceAdapterId: normalize(schema.sourceAdapterId),
    sheetName: normalize(schema.sheetName),
    headerRow: schema.headerRow,
    headers: schema.headers.map(normalize),
    columnMappings: normalizedMappings(schema.columnMappings),
  }
}

function profileSchema(
  profile: ImporterV2SourceProfile,
): ImporterV2ObservedSourceSchema {
  return {
    provider: profile.provider,
    sourceAdapterId: profile.sourceAdapterId,
    sheetName: profile.sheetName,
    headerRow: profile.headerRow,
    headers: profile.headers,
    columnMappings: profile.columnMappings,
  }
}

export function importerV2SchemaFingerprint(
  schema: ImporterV2ObservedSourceSchema,
) {
  validateImporterV2ObservedSchema(schema)
  return hash(normalizedSchema(schema))
}

export function validateImporterV2ObservedSchema(
  schema: ImporterV2ObservedSourceSchema,
) {
  const errors: string[] = []
  if (!normalize(schema.provider)) errors.push('Provider is required.')
  if (!normalize(schema.sourceAdapterId))
    errors.push('Source adapter is required.')
  if (!normalize(schema.sheetName)) errors.push('Worksheet name is required.')
  if (!Number.isInteger(schema.headerRow) || schema.headerRow < 1) {
    errors.push('Header row must be a positive integer.')
  }
  if (schema.headers.length === 0)
    errors.push('At least one source header is required.')

  const indexes = new Set<number>()
  const targets = new Set<ImporterV2Field>()
  for (const mapping of schema.columnMappings) {
    if (!Number.isInteger(mapping.columnIndex) || mapping.columnIndex < 0) {
      errors.push('Mapped column indexes must be non-negative integers.')
    }
    if (mapping.columnIndex >= schema.headers.length) {
      errors.push(
        `Mapped column ${mapping.columnIndex} is outside the header structure.`,
      )
    }
    if (indexes.has(mapping.columnIndex)) {
      errors.push(`Column ${mapping.columnIndex} is mapped more than once.`)
    }
    if (targets.has(mapping.targetField)) {
      errors.push(
        `Target field “${mapping.targetField}” is mapped more than once.`,
      )
    }
    indexes.add(mapping.columnIndex)
    targets.add(mapping.targetField)
  }

  if (errors.length > 0) throw new ImporterV2SourceProfileError(errors)
}

export function buildImporterV2SourceProfile(
  profile: Omit<ImporterV2SourceProfile, 'schemaFingerprint'>,
): ImporterV2SourceProfile {
  const schema = profileSchema({ ...profile, schemaFingerprint: '' })
  return {
    ...structuredClone(profile),
    schemaFingerprint: importerV2SchemaFingerprint(schema),
  }
}

function sameJson(left: unknown, right: unknown) {
  return (
    JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
  )
}

function scoreCandidate(
  observed: ImporterV2ObservedSourceSchema,
  profile: ImporterV2SourceProfile,
): Omit<ImporterV2ProfileCandidate, 'match'> {
  const source = normalizedSchema(observed)
  const candidate = normalizedSchema(profileSchema(profile))
  let score = 0
  const reasons: string[] = []
  const warnings: string[] = []

  const compare = (
    matches: boolean,
    points: number,
    success: string,
    warning: string,
  ) => {
    if (matches) {
      score += points
      reasons.push(success)
    } else warnings.push(warning)
  }

  compare(
    source.sourceAdapterId === candidate.sourceAdapterId,
    25,
    'Source adapter matches.',
    'Source adapter differs.',
  )
  compare(
    source.provider === candidate.provider,
    20,
    'Provider matches.',
    'Provider differs.',
  )
  compare(
    sameJson(source.headers, candidate.headers),
    25,
    'Normalized header structure matches.',
    'Header structure differs.',
  )
  compare(
    sameJson(source.columnMappings, candidate.columnMappings),
    25,
    'Mapped column signature matches.',
    'Mapped column signature differs.',
  )
  compare(
    source.sheetName === candidate.sheetName &&
      source.headerRow === candidate.headerRow,
    5,
    'Worksheet and header row match.',
    'Worksheet name or header row differs.',
  )

  return {
    profileId: profile.id,
    profileName: profile.name,
    profileVersion: profile.version,
    score,
    reasons,
    warnings,
  }
}

export function recognizeImporterV2SourceProfile(
  observed: ImporterV2ObservedSourceSchema,
  profiles: readonly ImporterV2SourceProfile[],
  explicitProfileId?: string | null,
): ImporterV2ProfileRecognition {
  const schemaFingerprint = importerV2SchemaFingerprint(observed)
  const activeProfiles = profiles.filter((profile) => profile.isActive)
  const scored = activeProfiles
    .map((profile) => {
      const candidate = scoreCandidate(observed, profile)
      const currentFingerprint = importerV2SchemaFingerprint(
        profileSchema(profile),
      )
      return {
        ...candidate,
        match:
          currentFingerprint === schemaFingerprint
            ? ('EXACT_SCHEMA' as const)
            : ('COMPATIBLE_SCHEMA' as const),
      }
    })
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.profileName.localeCompare(right.profileName) ||
        left.profileId.localeCompare(right.profileId),
    )

  if (explicitProfileId) {
    const selected = scored.find(
      (candidate) => candidate.profileId === explicitProfileId,
    )
    if (!selected) {
      return {
        schemaFingerprint,
        action: 'CREATE_PROFILE',
        suggestedProfileId: null,
        requiresConfirmation: true,
        candidates: scored,
        errors: [
          'The explicitly selected source profile does not exist or is inactive.',
        ],
      }
    }
    return {
      schemaFingerprint,
      action: 'CONFIRM_PROFILE',
      suggestedProfileId: selected.profileId,
      requiresConfirmation: true,
      candidates: [
        { ...selected, match: 'EXPLICIT_SELECTION' },
        ...scored.filter(
          (candidate) => candidate.profileId !== selected.profileId,
        ),
      ],
      errors: [],
    }
  }

  const eligible = scored.filter((candidate) => candidate.score >= 70)
  if (eligible.length === 0) {
    return {
      schemaFingerprint,
      action: 'CREATE_PROFILE',
      suggestedProfileId: null,
      requiresConfirmation: true,
      candidates: scored,
      errors: [],
    }
  }

  const topScore = eligible[0].score
  const strongest = eligible.filter((candidate) => candidate.score === topScore)
  return {
    schemaFingerprint,
    action: strongest.length === 1 ? 'CONFIRM_PROFILE' : 'CHOOSE_PROFILE',
    suggestedProfileId: strongest.length === 1 ? strongest[0].profileId : null,
    requiresConfirmation: true,
    candidates: eligible,
    errors: [],
  }
}

export function applyImporterV2ProfileOverrides(
  sourceProfile: ImporterV2SourceProfile,
  overrides: ImporterV2ProfileOverride,
): ImporterV2EffectiveSourceProfile {
  const overriddenFields = Object.keys(overrides).filter(
    (field) =>
      overrides[field as keyof ImporterV2ProfileOverride] !== undefined,
  ) as (keyof ImporterV2ProfileOverride)[]
  const profile = structuredClone({ ...sourceProfile, ...overrides })
  const schema = profileSchema(profile)

  return {
    profile: {
      ...profile,
      schemaFingerprint: importerV2SchemaFingerprint(schema),
    },
    overriddenFields,
  }
}
