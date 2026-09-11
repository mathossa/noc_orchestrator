import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  IMPORTER_V2_FIELDS,
  type ImporterV2CatalogSnapshot,
  type ImporterV2Field,
  type ImporterV2StagedRow,
} from '@/lib/importer-v2-evaluator'
import { evaluateImporterV2WithFirmware } from '@/lib/importer-v2-firmware-evaluation'
import {
  IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
  parseImporterV2Hierarchy,
} from '@/lib/importer-v2-hierarchy'
import {
  normalizeImporterV2Identity,
  resolveImporterV2Identity,
  type ImporterV2IdentityCandidate,
} from '@/lib/importer-v2-identity'
import { getLatestSuccessfulImporterV2SourceSnapshot } from '@/lib/importer-v2-identity-store'
import { evaluateImporterV2DeviceType } from '@/lib/importer-v2-profile-preview'
import { diffImporterV2RepeatImport } from '@/lib/importer-v2-repeat-diff'
import { listActiveImporterV2ExactMappings } from '@/lib/importer-v2-rule-store'
import {
  applyImporterV2ProfileOverrides,
  buildImporterV2SourceProfile,
  recognizeImporterV2SourceProfile,
  validateImporterV2ObservedSchema,
  type ImporterV2ColumnMapping,
  type ImporterV2SourceProfile,
} from '@/lib/importer-v2-source-profiles'
import {
  createImporterV2SourceProfile,
  listActiveImporterV2SourceProfiles,
} from '@/lib/importer-v2-source-profile-store'
import { stageImporterV2Workspace } from '@/lib/importer-v2-workspace-store'
import type { ImporterV2WorkspaceSeedRow } from '@/lib/importer-v2-workspace'
import {
  detectImporterV2HeaderRow,
  importerV2HeadersFromRow,
  importerV2ObservedSchema,
  importerV2SourceEvidence,
  mappedImporterV2Rows,
  suggestImporterV2ColumnMappings,
} from '@/lib/importer-v2-xlsx'
import { readXlsxWorkbook, XLSX_LIMITS, XlsxImportError, type XlsxSheet } from '@/lib/xlsx-reader'

export type ImporterV2XlsxStageConfig = {
  provider: string
  sourceAdapterId: string
  sheetName: string
  headerRow: number
  columnMappings: ImporterV2ColumnMapping[]
  profileId?: string | null
  profileName?: string | null
  confirmProfile: boolean
  hierarchyDelimiter?: string | null
}

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
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
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function assertXlsxFile(file: File) {
  if (!file.name.toLocaleLowerCase('en-US').endsWith('.xlsx')) {
    throw new XlsxImportError('Choose an .xlsx workbook.', 'INVALID_XLSX_TYPE')
  }
  if (file.size > XLSX_LIMITS.maxFileBytes) {
    throw new XlsxImportError(
      `XLSX files are limited to ${Math.floor(XLSX_LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
      'XLSX_TOO_LARGE',
    )
  }
}

async function workbookBuffer(file: File) {
  assertXlsxFile(file)
  return Buffer.from(await file.arrayBuffer())
}

function sheetInspection(sheet: XlsxSheet) {
  const detectedHeaderRow = detectImporterV2HeaderRow(sheet.rows)
  const headerSource = sheet.rows.find((row) => row.rowNumber === detectedHeaderRow)
  const headers = importerV2HeadersFromRow(headerSource, sheet.columnCount)
  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    previewRows: sheet.rows.slice(0, XLSX_LIMITS.previewRows),
    detectedHeaderRow,
    headers,
    suggestedMappings: suggestImporterV2ColumnMappings(headers),
  }
}

export async function inspectImporterV2Xlsx(input: {
  file: File
  provider: string
  sourceAdapterId: string
}) {
  const provider = clean(input.provider)
  const sourceAdapterId = clean(input.sourceAdapterId)
  if (!provider) throw new Error('Provider is required before inspecting a workbook.')
  if (!sourceAdapterId) throw new Error('Source adapter is required before inspecting a workbook.')

  const workbook = readXlsxWorkbook(await workbookBuffer(input.file), {
    maxMaterializedRowsPerSheet: XLSX_LIMITS.previewRows,
  })
  const profiles = await listActiveImporterV2SourceProfiles()
  const sheets = workbook.sheets.map((sheet) => {
    const inspected = sheetInspection(sheet)
    const observed = importerV2ObservedSchema({
      fileName: input.file.name,
      provider,
      sourceAdapterId,
      sheetName: inspected.name,
      headerRow: inspected.detectedHeaderRow,
      headers: inspected.headers,
      columnMappings: inspected.suggestedMappings,
    })
    return {
      ...inspected,
      recognition: recognizeImporterV2SourceProfile(observed, profiles),
    }
  })

  return {
    fileName: input.file.name,
    fileSize: input.file.size,
    limits: XLSX_LIMITS,
    sheets,
    profiles,
  }
}

function normalizedMappings(headers: readonly string[], mappings: readonly ImporterV2ColumnMapping[]) {
  return mappings.map((mapping) => ({
    columnIndex: mapping.columnIndex,
    sourceHeader: headers[mapping.columnIndex] ?? mapping.sourceHeader,
    targetField: mapping.targetField,
  }))
}

function hierarchyTemplate(delimiter: string | null | undefined) {
  return {
    ...structuredClone(IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE),
    delimiter: clean(delimiter) ?? IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE.delimiter,
  }
}

async function effectiveProfile(input: {
  config: ImporterV2XlsxStageConfig
  fileName: string
  headers: readonly string[]
  mappings: readonly ImporterV2ColumnMapping[]
}) {
  const { config } = input
  if (!config.confirmProfile) {
    throw new Error('Confirm the selected or new source profile before staging.')
  }
  const profiles = await listActiveImporterV2SourceProfiles()
  const observed = importerV2ObservedSchema({
    fileName: input.fileName,
    provider: config.provider,
    sourceAdapterId: config.sourceAdapterId,
    sheetName: config.sheetName,
    headerRow: config.headerRow,
    headers: input.headers,
    columnMappings: input.mappings,
  })
  validateImporterV2ObservedSchema(observed)

  if (clean(config.profileId)) {
    const profile = profiles.find((candidate) => candidate.id === config.profileId)
    if (!profile) throw new Error('The selected source profile no longer exists or is inactive.')
    const recognition = recognizeImporterV2SourceProfile(observed, profiles, profile.id)
    if (recognition.errors.length > 0) throw new Error(recognition.errors.join(' '))
    return applyImporterV2ProfileOverrides(profile, {
      sheetName: config.sheetName,
      headerRow: config.headerRow,
      headers: input.headers,
      columnMappings: input.mappings,
      hierarchyTemplate: {
        ...profile.hierarchyTemplate,
        delimiter: clean(config.hierarchyDelimiter) ?? profile.hierarchyTemplate.delimiter,
      },
    }).profile
  }

  const name = clean(config.profileName)
  if (!name) throw new Error('Enter a name for the new source profile.')
  const candidate = buildImporterV2SourceProfile({
    id: randomUUID(),
    name,
    version: '1',
    isActive: true,
    provider: config.provider,
    sourceAdapterId: config.sourceAdapterId,
    sheetName: config.sheetName,
    headerRow: config.headerRow,
    headers: input.headers,
    columnMappings: input.mappings,
    hierarchyTemplate: hierarchyTemplate(config.hierarchyDelimiter),
    deviceTypePolicy: { version: '1', defaultAction: 'INCLUDE', rules: [] },
    defaults: {},
    exactValueAliases: [],
  })
  return createImporterV2SourceProfile(candidate)
}

function prepareRows(
  rows: readonly ImporterV2StagedRow[],
  profile: ImporterV2SourceProfile,
) {
  const directHierarchy = new Set(profile.columnMappings.map((mapping) => mapping.targetField))
  return rows.map((sourceRow) => {
    const row: ImporterV2StagedRow = {
      ...sourceRow,
      rawValues: { ...profile.defaults, ...sourceRow.rawValues },
    }
    if (!directHierarchy.has('site') && !directHierarchy.has('businessUnit')) {
      const parsed = parseImporterV2Hierarchy(
        row.rowNumber,
        row.rawValues.customer,
        profile.hierarchyTemplate,
      )
      row.rawValues.customer = parsed.effectiveValues.customer
      row.rawValues.businessUnit = parsed.effectiveValues.businessUnit
      row.rawValues.site = parsed.effectiveValues.site
    }

    const typeDecision = evaluateImporterV2DeviceType(row.rawValues.deviceType, profile.deviceTypePolicy)
    if (typeDecision.action === 'EXCLUDE') {
      row.inclusionDecision = {
        status: 'EXCLUDED',
        source: 'PROFILE_RULE',
        decisionId: typeDecision.matchedRuleIds.join(',') || 'device-type-policy',
        explanation: typeDecision.explanation,
      }
    }
    row.sourceRecordKey = row.rawValues.sourceId ?? row.rawValues.serialNumber ?? row.rawValues.macAddress ?? null
    return row
  })
}

async function catalogSnapshot(): Promise<{
  catalog: ImporterV2CatalogSnapshot
  compatibilityRules: Array<{ id: string; vendor: string; model: string; platforms: string[] }>
}> {
  const [customers, units, sites, vendors, families, models, deviceTypes] = await Promise.all([
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.customerOrganizationUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.site.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.deviceModelFamily.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.deviceModel.findMany({
      where: { isActive: true },
      select: { id: true, model: true, platform: true, vendor: { select: { name: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.deviceType.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
  ])
  const value = (records: readonly { id: string; name: string }[]) => records.map((record) => ({ id: record.id, label: record.name }))
  const catalogValues: ImporterV2CatalogSnapshot['values'] = {
    customer: value(customers),
    businessUnit: value(units),
    site: value(sites),
    vendor: value(vendors),
    productFamily: value(families),
    model: models.map((record) => ({ id: record.id, label: record.model })),
    deviceType: value(deviceTypes),
  }
  return {
    catalog: { version: hash(catalogValues), values: catalogValues },
    compatibilityRules: models
      .filter((record): record is typeof record & { platform: string } => Boolean(clean(record.platform)))
      .map((record) => ({
        id: `device-model:${record.id}`,
        vendor: record.vendor.name,
        model: record.model,
        platforms: [record.platform],
      })),
  }
}

async function identityResolvers(provider: string) {
  const records = await prisma.importerV2DeviceCrosswalk.findMany({
    where: { provider },
    orderBy: [{ canonicalDeviceId: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      canonicalDeviceId: true,
      sourceId: true,
      serialNumber: true,
      macAddress: true,
    },
  })
  const sourceIds = new Map<string, Set<number>>()
  const serials = new Map<string, Set<number>>()
  const macs = new Map<string, Set<number>>()
  const add = (map: Map<string, Set<number>>, key: string | null, index: number) => {
    if (!key) return
    const indexes = map.get(key) ?? new Set<number>()
    indexes.add(index)
    map.set(key, indexes)
  }
  records.forEach((record, index) => {
    const normalized = normalizeImporterV2Identity(record)
    add(sourceIds, normalized.sourceId, index)
    add(serials, normalized.serialNumber, index)
    add(macs, normalized.macAddress, index)
  })

  return (identifiers: { sourceId?: string | null; serialNumber?: string | null; macAddress?: string | null }) => {
    const normalized = normalizeImporterV2Identity(identifiers)
    const indexes = new Set<number>()
    for (const index of sourceIds.get(normalized.sourceId ?? '') ?? []) indexes.add(index)
    for (const index of serials.get(normalized.serialNumber ?? '') ?? []) indexes.add(index)
    for (const index of macs.get(normalized.macAddress ?? '') ?? []) indexes.add(index)
    return [...indexes].map((index): ImporterV2IdentityCandidate => ({
      canonicalDeviceId: records[index].canonicalDeviceId,
      crosswalkId: records[index].id,
      identifiers: {
        sourceId: records[index].sourceId,
        serialNumber: records[index].serialNumber,
        macAddress: records[index].macAddress,
      },
    }))
  }
}

function effectiveValues(row: ReturnType<typeof evaluateImporterV2WithFirmware>['rows'][number]) {
  return Object.fromEntries(
    IMPORTER_V2_FIELDS.map((field) => [
      field,
      row.proposedCanonicalValues[field]?.label ?? row.normalizedValues[field] ?? null,
    ]),
  ) as Partial<Record<ImporterV2Field, string | null>>
}

function primaryStatus(statuses: readonly string[]) {
  if (statuses.includes('EXCLUDED')) return 'EXCLUDED'
  if (statuses.includes('NEEDS_REVIEW')) return 'NEEDS_REVIEW'
  if (statuses.includes('WARNING')) return 'WARNING'
  return 'VALID'
}

function rowConfidence(row: ReturnType<typeof evaluateImporterV2WithFirmware>['rows'][number]) {
  const important: ImporterV2Field[] = ['customer', 'site', 'vendor', 'model', 'deviceType', 'currentFirmware']
  const confidences = important.map((field) => row.fields[field].decision.confidence)
  if (confidences.includes('LOW')) return 'LOW'
  if (confidences.includes('MEDIUM')) return 'MEDIUM'
  return 'HIGH'
}

function firmwareEvidencePattern(row: ReturnType<typeof evaluateImporterV2WithFirmware>['rows'][number]) {
  const firmware = clean(row.rawValues.firmwareVersion)
  const software = clean(row.rawValues.softwareVersion)
  if (firmware && software) return 'firmware+software'
  if (firmware) return 'firmware-only'
  if (software) return 'software-only'
  return 'missing-or-placeholder'
}

export async function stageImporterV2Xlsx(input: {
  file: File
  config: ImporterV2XlsxStageConfig
}) {
  const provider = clean(input.config.provider)
  const sourceAdapterId = clean(input.config.sourceAdapterId)
  if (!provider || !sourceAdapterId) throw new Error('Provider and source adapter are required.')
  if (!Number.isInteger(input.config.headerRow) || input.config.headerRow < 1) throw new Error('Header row must be a positive integer.')

  const workbook = readXlsxWorkbook(await workbookBuffer(input.file))
  const sheet = workbook.sheets.find((candidate) => candidate.name === input.config.sheetName)
  if (!sheet) throw new Error(`Worksheet “${input.config.sheetName}” was not found in the uploaded workbook.`)
  const headerSource = sheet.rows.find((row) => row.rowNumber === input.config.headerRow)
  if (!headerSource) throw new Error(`Header row ${input.config.headerRow} is empty or unavailable.`)
  const headers = importerV2HeadersFromRow(headerSource, sheet.columnCount)
  const mappings = normalizedMappings(headers, input.config.columnMappings)
  const config = { ...input.config, provider, sourceAdapterId }
  const profile = await effectiveProfile({ config, fileName: input.file.name, headers, mappings })

  const sourceRows = mappedImporterV2Rows({
    sheet,
    headerRow: config.headerRow,
    mappings,
    defaults: profile.defaults,
  })
  if (sourceRows.length === 0) throw new Error('No data rows were found below the selected header row.')
  const rows = prepareRows(sourceRows, profile)
  const { catalog, compatibilityRules } = await catalogSnapshot()
  const exactMappings = await listActiveImporterV2ExactMappings({ provider, profileId: profile.id })
  const rememberedMappings = [
    ...profile.exactValueAliases.map((mapping) => ({
      id: mapping.id,
      field: mapping.field,
      normalizedInput: mapping.normalizedInput,
      target: mapping.target,
      explanation: 'Saved source-profile exact mapping.',
    })),
    ...exactMappings.map((mapping) => ({
      id: mapping.id,
      field: mapping.field,
      normalizedInput: mapping.normalizedInput,
      target: mapping.target,
      explanation: mapping.explanation,
    })),
  ].toSorted((left, right) => left.id.localeCompare(right.id))

  const evaluation = evaluateImporterV2WithFirmware({
    profile: {
      id: profile.id,
      version: profile.version,
      sourceAdapterId,
      provider,
      requiredFields: ['customer', 'site', 'vendor', 'model', 'deviceType'],
      warnWhenUnresolvedFields: ['productFamily', 'softwarePlatform', 'currentFirmware'],
    },
    catalog,
    rules: {
      version: hash(rememberedMappings),
      manualOverrides: [],
      rememberedMappings,
      profileRules: [],
    },
    parsers: { version: 'generic-parsers-v1', definitions: [] },
    suggestions: { version: 'suggestions-v1', suggestions: [] },
    firmwareContext: {
      compatibilityVersion: hash(compatibilityRules),
      compatibilityRules,
    },
    rows,
  })

  const candidatesFor = await identityResolvers(provider)
  const identities = evaluation.rows.map((row) => {
    const identifiers = {
      sourceId: row.rawValues.sourceId,
      serialNumber: row.rawValues.serialNumber,
      macAddress: row.rawValues.macAddress,
    }
    return resolveImporterV2Identity(
      { provider, sourceAdapterId, identifiers, context: row.normalizedValues },
      candidatesFor(identifiers),
    )
  })

  const latest = await getLatestSuccessfulImporterV2SourceSnapshot({ provider, sourceAdapterId })
  const repeat = diffImporterV2RepeatImport({
    previousRows: latest?.rows ?? [],
    currentRows: evaluation.rows.map((row, index) => ({
      rowNumber: row.rowNumber,
      canonicalDeviceId:
        identities[index].kind === 'MATCH_SUGGESTED'
          ? identities[index].candidates[0]?.canonicalDeviceId ?? null
          : null,
      identityStatus:
        identities[index].kind === 'MATCH_SUGGESTED'
          ? 'MATCHED'
          : identities[index].kind === 'NEW'
            ? 'NEW'
            : 'AMBIGUOUS',
      identifiers: {
        sourceId: row.rawValues.sourceId,
        serialNumber: row.rawValues.serialNumber,
        macAddress: row.rawValues.macAddress,
      },
      values: effectiveValues(row),
    })),
    isFullInventoryExport: false,
  })
  const repeatByRow = new Map(repeat.items.filter((item) => item.rowNumber !== null).map((item) => [item.rowNumber!, item]))
  const sourceRowsByNumber = new Map(sheet.rows.map((row) => [row.rowNumber, row]))

  const seedRows: ImporterV2WorkspaceSeedRow[] = evaluation.rows.map((row, index) => {
    const identity = identities[index]
    const repeatItem = repeatByRow.get(row.rowNumber)
    const statuses = new Set<string>(row.statuses)
    if (row.inclusion !== 'EXCLUDED' && identity.requiresConfirmation) statuses.add('NEEDS_REVIEW')
    if (repeatItem) statuses.add(repeatItem.classification)
    const sourceRow = sourceRowsByNumber.get(row.rowNumber)
    const evaluated = {
      ...row,
      sourceEvidence: sourceRow ? importerV2SourceEvidence({ sourceRow, headers }) : {},
    }
    return {
      rowNumber: row.rowNumber,
      sourceFingerprint: row.sourceFingerprint,
      inclusion: row.inclusion,
      statuses: [...statuses],
      primaryStatus: primaryStatus([...statuses]),
      repeatClassification: repeatItem?.classification ?? 'NEW',
      issueCount: row.issues.length,
      hasErrors: row.issues.some((issue) => issue.severity === 'ERROR'),
      sourceName: row.rawValues.deviceName,
      hostname: row.rawValues.hostname,
      customer: row.proposedCanonicalValues.customer?.label ?? row.rawValues.customer,
      businessUnit: row.proposedCanonicalValues.businessUnit?.label ?? row.rawValues.businessUnit,
      site: row.proposedCanonicalValues.site?.label ?? row.rawValues.site,
      vendor: row.proposedCanonicalValues.vendor?.label ?? row.rawValues.vendor,
      deviceType: row.proposedCanonicalValues.deviceType?.label ?? row.rawValues.deviceType,
      sourceModel: row.rawValues.model,
      canonicalModel: row.proposedCanonicalValues.model?.label ?? null,
      productFamily: row.proposedCanonicalValues.productFamily?.label ?? row.rawValues.productFamily,
      softwarePlatform: row.firmware.proposedSoftwarePlatform ?? row.rawValues.softwarePlatform,
      firmwareEvidencePattern: firmwareEvidencePattern(row),
      rawFirmwareVersion: row.rawValues.firmwareVersion,
      rawSoftwareVersion: row.rawValues.softwareVersion,
      interpretedFirmware: row.firmware.runningVersion,
      confidence: rowConfidence(row),
      evaluated,
      identityResolution: identity,
      alternatives: null,
      repeatDiff: repeatItem ?? null,
    }
  })

  const batch = await stageImporterV2Workspace({
    name: input.file.name,
    provider,
    sourceAdapterId,
    profileId: profile.id,
    profileVersion: profile.version,
    evaluationFingerprint: evaluation.evaluationFingerprint,
    rows: seedRows,
  })

  return {
    batch: {
      id: batch.id,
      name: batch.name,
      rowCount: batch.rowCount,
      status: batch.status,
    },
    profile: { id: profile.id, name: profile.name, version: profile.version },
    evaluation: {
      fingerprint: evaluation.evaluationFingerprint,
      firmwareInterpreterVersion: evaluation.firmwareInterpreterVersion,
      firmwareCompatibilityVersion: evaluation.firmwareCompatibilityVersion,
    },
  }
}
