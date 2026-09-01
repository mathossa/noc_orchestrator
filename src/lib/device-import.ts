import type { XlsxRow, XlsxSheet } from '@/lib/xlsx-reader'

export const DEVICE_IMPORT_FIELDS = [
  'customer',
  'site',
  'name',
  'hostname',
  'serialNumber',
  'vendor',
  'model',
  'deviceType',
  'managementAddress',
  'currentFirmware',
  'contract',
  'externalProvider',
  'externalId',
  'notes',
] as const

export type DeviceImportField = (typeof DEVICE_IMPORT_FIELDS)[number]
export type DeviceImportMapping = Record<string, DeviceImportField | 'ignore'>

export type DeviceImportOptions = {
  sheetName: string
  headerRow: number
  mapping: DeviceImportMapping
  defaults: {
    customerId: string | null
    siteId: string | null
    externalProvider: string | null
  }
}

export type DeviceImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' | 'ERROR'

export type DeviceImportIssue = {
  level: 'error' | 'warning'
  message: string
}

export type DeviceImportChange = {
  field: string
  label: string
  before: string | null
  after: string | null
}

export type DeviceImportPreviewRow = {
  rowNumber: number
  action: DeviceImportAction
  importable: boolean
  existingDeviceId: string | null
  identity: string
  customer: string | null
  site: string | null
  model: string | null
  currentFirmware: string | null
  issues: DeviceImportIssue[]
  changes: DeviceImportChange[]
}

export type DeviceImportPreview = {
  fileName: string
  sheetName: string
  headerRow: number
  rows: DeviceImportPreviewRow[]
  counts: {
    create: number
    update: number
    unchanged: number
    conflict: number
    error: number
    importable: number
  }
}

export type DeviceImportResult = {
  created: number
  updated: number
  skipped: number
  failed: number
  importedRows: number[]
}

export class DeviceImportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportValidationError'
  }
}

const aliases: Record<DeviceImportField, string[]> = {
  customer: ['customer', 'client', 'klant', 'organisatie', 'organization', 'organisation'],
  site: ['site', 'location', 'locatie', 'vestiging', 'office', 'campus'],
  name: ['device name', 'device', 'apparaatnaam', 'inventory name', 'name'],
  hostname: ['hostname', 'host name', 'device hostname', 'fqdn', 'dns name'],
  serialNumber: ['serial number', 'serial', 'serial no', 'serialnumber', 'serienummer', 'sn'],
  vendor: ['vendor', 'manufacturer', 'fabrikant', 'merk', 'make'],
  model: ['device model', 'hardware model', 'model', 'product model', 'product'],
  deviceType: ['device type', 'hardware type', 'category', 'categorie', 'soort apparaat'],
  managementAddress: [
    'management address',
    'management ip',
    'mgmt ip',
    'ip address',
    'ip-adres',
    'ip adres',
    'address',
  ],
  currentFirmware: [
    'current firmware',
    'firmware version',
    'firmware',
    'software version',
    'current version',
    'ios version',
    'version',
  ],
  contract: ['contract', 'contract type', 'contracttype', 'service contract', 'dienstverlening'],
  externalProvider: ['external provider', 'source system', 'source provider', 'provider', 'bron'],
  externalId: ['external id', 'source id', 'asset id', 'device id', 'object id', 'external identifier'],
  notes: ['notes', 'note', 'opmerkingen', 'remarks', 'comment', 'comments'],
}

const aliasLookup = new Map<string, DeviceImportField>()
for (const field of DEVICE_IMPORT_FIELDS) {
  for (const alias of aliases[field]) aliasLookup.set(normalizeImportText(alias), field)
}

export function normalizeImportText(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
    : ''
}

function nonEmptyCells(row: XlsxRow) {
  return row.values.map((value) => value.trim()).filter(Boolean)
}

export function detectHeaderRow(rows: XlsxRow[]) {
  const candidates = rows.filter((row) => row.rowNumber <= 25)
  let best: { rowNumber: number; score: number } | null = null

  for (const row of candidates) {
    const values = nonEmptyCells(row)
    if (values.length < 2) continue
    const recognized = values.filter((value) => aliasLookup.has(normalizeImportText(value))).length
    const unique = new Set(values.map(normalizeImportText)).size
    const numeric = values.filter((value) => /^[-+]?\d+(?:[.,]\d+)?$/.test(value)).length
    const score = recognized * 12 + unique + values.length - numeric * 2
    if (!best || score > best.score) best = { rowNumber: row.rowNumber, score }
  }

  return best?.rowNumber ?? candidates[0]?.rowNumber ?? 1
}

export function headersFromRow(row: XlsxRow | undefined, columnCount?: number) {
  const count = Math.max(columnCount ?? 0, row?.values.length ?? 0)
  const seen = new Map<string, number>()
  return Array.from({ length: count }, (_unused, index) => {
    const raw = row?.values[index]?.trim() ?? ''
    const base = raw || `Column ${columnName(index)}`
    const normalized = normalizeImportText(base)
    const occurrence = (seen.get(normalized) ?? 0) + 1
    seen.set(normalized, occurrence)
    return occurrence === 1 ? base : `${base} (${occurrence})`
  })
}

export function suggestColumnMapping(headers: string[]): DeviceImportMapping {
  const mapping: DeviceImportMapping = {}
  const used = new Set<DeviceImportField>()

  headers.forEach((header, index) => {
    const field = aliasLookup.get(normalizeImportText(header))
    if (field && !used.has(field)) {
      mapping[String(index)] = field
      used.add(field)
    } else {
      mapping[String(index)] = 'ignore'
    }
  })

  return mapping
}

export function columnName(index: number) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

export function parseDeviceImportOptions(value: unknown): DeviceImportOptions {
  const input = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const sheetName = typeof input.sheetName === 'string' ? input.sheetName.trim() : ''
  const headerRow = Number(input.headerRow)
  const rawMapping = typeof input.mapping === 'object' && input.mapping !== null
    ? (input.mapping as Record<string, unknown>)
    : {}
  const rawDefaults = typeof input.defaults === 'object' && input.defaults !== null
    ? (input.defaults as Record<string, unknown>)
    : {}

  if (!sheetName) throw new DeviceImportValidationError('Choose a worksheet to import.')
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 5000) {
    throw new DeviceImportValidationError('Choose a valid worksheet header row.')
  }

  const mapping: DeviceImportMapping = {}
  const used = new Set<DeviceImportField>()
  for (const [column, rawField] of Object.entries(rawMapping)) {
    if (!/^\d+$/.test(column)) continue
    if (rawField === 'ignore') {
      mapping[column] = 'ignore'
      continue
    }
    if (typeof rawField !== 'string' || !DEVICE_IMPORT_FIELDS.includes(rawField as DeviceImportField)) {
      throw new DeviceImportValidationError('The column mapping contains an unsupported destination field.')
    }
    const field = rawField as DeviceImportField
    if (used.has(field)) throw new DeviceImportValidationError(`Map ${field} from only one spreadsheet column.`)
    mapping[column] = field
    used.add(field)
  }

  if (![...Object.values(mapping)].some((field) => field !== 'ignore')) {
    throw new DeviceImportValidationError('Map at least one spreadsheet column before previewing the import.')
  }

  const cleanDefault = (field: string) => {
    const raw = rawDefaults[field]
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null
  }

  return {
    sheetName,
    headerRow,
    mapping,
    defaults: {
      customerId: cleanDefault('customerId'),
      siteId: cleanDefault('siteId'),
      externalProvider: cleanDefault('externalProvider'),
    },
  }
}

export function mappedRows(sheet: XlsxSheet, options: DeviceImportOptions) {
  if (sheet.name !== options.sheetName) throw new DeviceImportValidationError('The selected worksheet is unavailable.')
  const mappedColumns = Object.entries(options.mapping)
    .filter((entry): entry is [string, DeviceImportField] => entry[1] !== 'ignore')
    .map(([column, field]) => ({ columnIndex: Number(column), field }))

  return sheet.rows
    .filter((row) => row.rowNumber > options.headerRow)
    .map((row) => {
      const values = {} as Record<DeviceImportField, string | null>
      for (const field of DEVICE_IMPORT_FIELDS) values[field] = null
      for (const { columnIndex, field } of mappedColumns) {
        const raw = row.values[columnIndex]?.normalize('NFKC').trim() ?? ''
        values[field] = raw || null
      }
      return { rowNumber: row.rowNumber, values }
    })
    .filter((row) => Object.values(row.values).some(Boolean))
}

export function countImportPreview(rows: DeviceImportPreviewRow[]) {
  return {
    create: rows.filter((row) => row.action === 'CREATE').length,
    update: rows.filter((row) => row.action === 'UPDATE').length,
    unchanged: rows.filter((row) => row.action === 'UNCHANGED').length,
    conflict: rows.filter((row) => row.action === 'CONFLICT').length,
    error: rows.filter((row) => row.action === 'ERROR').length,
    importable: rows.filter((row) => row.importable).length,
  }
}
