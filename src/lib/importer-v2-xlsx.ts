import { IMPORTER_V2_FIELDS, type ImporterV2Field, type ImporterV2StagedRow } from '@/lib/importer-v2-evaluator'
import type { ImporterV2ColumnMapping, ImporterV2ObservedSourceSchema } from '@/lib/importer-v2-source-profiles'
import type { XlsxRow, XlsxSheet } from '@/lib/xlsx-reader'

const HEADER_ALIASES: Record<ImporterV2Field, readonly string[]> = {
  customer: ['customer', 'client', 'organisation', 'organization', 'organisation name', 'organization name', 'customer name'],
  businessUnit: ['business unit', 'businessunit', 'subdomain', 'sub domain', 'division', 'department'],
  site: ['site', 'site name', 'location', 'location name'],
  deviceName: ['device name', 'device', 'name', 'display name'],
  hostname: ['hostname', 'host name', 'fqdn', 'dns name'],
  sourceId: ['source id', 'source device id', 'device id', 'external id', 'id'],
  serialNumber: ['serial number', 'serial', 'serial no', 'serial #', 'sn'],
  macAddress: ['mac address', 'mac', 'macaddress'],
  vendor: ['vendor', 'manufacturer', 'make', 'manufacturer name'],
  productFamily: ['product family', 'model family', 'family'],
  softwarePlatform: ['software platform', 'platform', 'os platform', 'operating system'],
  model: ['model', 'device model', 'make & model', 'make and model', 'product', 'model name'],
  deviceType: ['device type', 'type', 'category', 'device category'],
  managementAddress: ['management address', 'management ip', 'ip address', 'ip', 'address'],
  currentFirmware: ['current firmware', 'running firmware', 'running version', 'version'],
  firmwareVersion: ['firmware version', 'firmware'],
  softwareVersion: ['software version', 'os version', 'software'],
  notes: ['notes', 'note', 'comments', 'comment'],
}

const HEADER_LOOKUP = new Map<string, ImporterV2Field>()
for (const field of IMPORTER_V2_FIELDS) {
  for (const alias of HEADER_ALIASES[field]) HEADER_LOOKUP.set(normalizeHeader(alias), field)
}

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

export function normalizeImporterV2Header(value: string | null | undefined) {
  return (clean(value) ?? '')
    .toLocaleLowerCase('en-US')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function headerScore(row: XlsxRow) {
  const normalized = row.values.map(normalizeImporterV2Header)
  const recognized = normalized.filter((value) => HEADER_LOOKUP.has(value)).length
  const unique = new Set(normalized.filter(Boolean)).size
  return recognized * 10 + Math.min(unique, 8)
}

export function detectImporterV2HeaderRow(rows: readonly XlsxRow[]) {
  const candidates = rows.slice(0, 25)
  const best = candidates
    .map((row) => ({ rowNumber: row.rowNumber, score: headerScore(row) }))
    .toSorted((left, right) => right.score - left.score || left.rowNumber - right.rowNumber)[0]
  return best && best.score > 0 ? best.rowNumber : (rows[0]?.rowNumber ?? 1)
}

export function importerV2HeadersFromRow(row: XlsxRow | undefined, columnCount: number) {
  return Array.from({ length: columnCount }, (_unused, index) => clean(row?.values[index]) ?? `Column ${index + 1}`)
}

export function suggestImporterV2ColumnMappings(headers: readonly string[]): ImporterV2ColumnMapping[] {
  const usedTargets = new Set<ImporterV2Field>()
  const mappings: ImporterV2ColumnMapping[] = []
  headers.forEach((header, columnIndex) => {
    const targetField = HEADER_LOOKUP.get(normalizeImporterV2Header(header))
    if (!targetField || usedTargets.has(targetField)) return
    usedTargets.add(targetField)
    mappings.push({ columnIndex, sourceHeader: header, targetField })
  })
  return mappings
}

export function importerV2ObservedSchema(input: {
  fileName?: string | null
  provider: string
  sourceAdapterId: string
  sheetName: string
  headerRow: number
  headers: readonly string[]
  columnMappings: readonly ImporterV2ColumnMapping[]
}): ImporterV2ObservedSourceSchema {
  return {
    fileName: input.fileName ?? null,
    provider: input.provider,
    sourceAdapterId: input.sourceAdapterId,
    sheetName: input.sheetName,
    headerRow: input.headerRow,
    headers: [...input.headers],
    columnMappings: [...input.columnMappings].toSorted((a, b) => a.columnIndex - b.columnIndex),
  }
}

export function mappedImporterV2Rows(input: {
  sheet: XlsxSheet
  headerRow: number
  mappings: readonly ImporterV2ColumnMapping[]
  defaults?: Partial<Record<ImporterV2Field, string>>
}) {
  const rows: ImporterV2StagedRow[] = []
  for (const sourceRow of input.sheet.rows) {
    if (sourceRow.rowNumber <= input.headerRow) continue
    const rawValues: Partial<Record<ImporterV2Field, string | null>> = {}
    for (const field of IMPORTER_V2_FIELDS) {
      const fallback = clean(input.defaults?.[field])
      if (fallback) rawValues[field] = fallback
    }
    for (const mapping of input.mappings) {
      rawValues[mapping.targetField] = clean(sourceRow.values[mapping.columnIndex])
    }
    if (!Object.values(rawValues).some(Boolean)) continue
    rows.push({
      rowNumber: sourceRow.rowNumber,
      sourceRecordKey: rawValues.sourceId ?? rawValues.serialNumber ?? rawValues.macAddress ?? null,
      rawValues,
    })
  }
  return rows
}

export function importerV2SourceEvidence(input: {
  sourceRow: XlsxRow
  headers: readonly string[]
}) {
  return Object.fromEntries(
    input.headers.map((header, index) => [header || `Column ${index + 1}`, clean(input.sourceRow.values[index])]),
  )
}
