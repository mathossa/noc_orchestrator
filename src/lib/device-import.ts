import type { XlsxRow, XlsxSheet } from '@/lib/xlsx-reader'

export const DEVICE_IMPORT_FIELDS = [
  'organizationSite',
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
  'firmwareVersion',
  'softwareVersion',
  'contract',
  'externalProvider',
  'externalId',
  'notes',
] as const

export const DEVICE_IMPORT_REFERENCE_KINDS = [
  'CUSTOMER',
  'SITE',
  'VENDOR',
  'DEVICE_TYPE',
  'DEVICE_MODEL',
  'CONTRACT_TYPE',
  'FIRMWARE_RELEASE',
] as const

export type DeviceImportField = (typeof DEVICE_IMPORT_FIELDS)[number]
export type DeviceImportReferenceKind = (typeof DEVICE_IMPORT_REFERENCE_KINDS)[number]
export type DeviceImportMapping = Record<string, DeviceImportField | 'ignore'>
export type DeviceImportResolutionMap = Record<string, string>

export type DeviceImportProfileSettings = {
  sheetName: string
  headerRow: number
  mapping: DeviceImportMapping
  defaults: {
    customerId: string | null
    siteId: string | null
    externalProvider: string | null
  }
  organizationSiteDelimiter: string
}

export type DeviceImportOptions = DeviceImportProfileSettings & {
  profileId: string | null
  resolutions: DeviceImportResolutionMap
}

export type DeviceImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' | 'ERROR'

export type DeviceImportReferenceIssue = {
  kind: DeviceImportReferenceKind
  sourceValue: string
  contextKey: string
  customerId?: string | null
  customerName?: string | null
  vendorId?: string | null
  vendorName?: string | null
  platform?: string | null
  modelName?: string | null
}

export type DeviceImportIssue = {
  level: 'error' | 'warning'
  message: string
  reference?: DeviceImportReferenceIssue
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

export type DeviceImportUnresolvedReference = {
  key: string
  kind: DeviceImportReferenceKind
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  customerId: string | null
  customerName: string | null
  vendorId: string | null
  vendorName: string | null
  platform: string | null
  modelName: string | null
  rowNumbers: number[]
}

export type DeviceImportPreview = {
  fileName: string
  sheetName: string
  headerRow: number
  rows: DeviceImportPreviewRow[]
  unresolvedReferences: DeviceImportUnresolvedReference[]
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
  organizationSite: ['organization name', 'organisation name', 'organization / site', 'organisation / site'],
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
  currentFirmware: ['current firmware', 'firmware', 'current version', 'version'],
  firmwareVersion: ['firmware version'],
  softwareVersion: ['software version', 'ios version', 'os version'],
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

export function importResolutionKey(kind: DeviceImportReferenceKind, sourceValue: string, contextKey = '') {
  return `${kind}|${contextKey}|${normalizeImportText(sourceValue)}`
}

export function extractFirmwareVersion(value: string | null) {
  if (!value) return null
  const cleaned = value.normalize('NFKC').trim()
  const explicitV = cleaned.match(/(?:^|[\s_-])v(\d+(?:\.\d+){1,5})\b/i)
  if (explicitV) return explicitV[1]
  const dotted = cleaned.match(/\b(\d+(?:\.\d+){1,5})\b/)
  return dotted?.[1] ?? cleaned
}

export function splitOrganizationSite(value: string | null, delimiter = ' - ') {
  if (!value) return { customer: null, site: null }
  const cleaned = value.normalize('NFKC').trim()
  const normalizedDelimiter = delimiter || ' - '
  const splitAt = cleaned.lastIndexOf(normalizedDelimiter)
  if (splitAt <= 0) return { customer: cleaned || null, site: null }
  const customer = cleaned.slice(0, splitAt).trim()
  const site = cleaned.slice(splitAt + normalizedDelimiter.length).trim()
  return { customer: customer || null, site: site || null }
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
  const rawResolutions = typeof input.resolutions === 'object' && input.resolutions !== null
    ? (input.resolutions as Record<string, unknown>)
    : {}

  if (!sheetName) throw new DeviceImportValidationError('Choose a worksheet to import.')
  if (!Number.isInteger(headerRow) || headerRow < 1) {
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

  const resolutions: DeviceImportResolutionMap = {}
  for (const [key, targetId] of Object.entries(rawResolutions)) {
    if (typeof targetId === 'string' && targetId.trim()) resolutions[key] = targetId.trim()
  }

  const profileId = typeof input.profileId === 'string' && input.profileId.trim() ? input.profileId.trim() : null
  const rawDelimiter = typeof input.organizationSiteDelimiter === 'string' ? input.organizationSiteDelimiter : ' - '
  const organizationSiteDelimiter = rawDelimiter.length > 0 && rawDelimiter.length <= 20 ? rawDelimiter : ' - '

  return {
    profileId,
    sheetName,
    headerRow,
    mapping,
    defaults: {
      customerId: cleanDefault('customerId'),
      siteId: cleanDefault('siteId'),
      externalProvider: cleanDefault('externalProvider'),
    },
    organizationSiteDelimiter,
    resolutions,
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

      if (values.organizationSite) {
        const split = splitOrganizationSite(values.organizationSite, options.organizationSiteDelimiter)
        if (!values.customer) values.customer = split.customer
        if (!values.site) values.site = split.site
      }

      if (values.firmwareVersion) values.currentFirmware = values.firmwareVersion
      else if (!values.currentFirmware && values.softwareVersion) values.currentFirmware = extractFirmwareVersion(values.softwareVersion)

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
