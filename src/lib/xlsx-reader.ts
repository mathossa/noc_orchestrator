import { inflateRawSync } from 'node:zlib'
import path from 'node:path'

export const XLSX_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxSheets: 20,
  maxRowsPerSheet: 5000,
  maxColumnsPerSheet: 100,
  maxUncompressedBytes: 40 * 1024 * 1024,
  previewRows: 30,
} as const

export class XlsxImportError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_XLSX',
  ) {
    super(message)
    this.name = 'XlsxImportError'
  }
}

export type XlsxRow = {
  rowNumber: number
  values: string[]
}

export type XlsxSheet = {
  name: string
  rowCount: number
  columnCount: number
  rows: XlsxRow[]
}

export type XlsxWorkbook = {
  sheets: XlsxSheet[]
}

type ZipEntry = {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  flags: number
}

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attribute(source: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`))
  return match ? decodeXml(match[1] ?? match[2] ?? '') : null
}

function findEndOfCentralDirectory(data: Buffer) {
  if (data.length < 22) throw new XlsxImportError('The uploaded file is not a valid XLSX/ZIP workbook.')
  const minimumOffset = Math.max(0, data.length - 65_557)
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new XlsxImportError('The uploaded file is not a valid XLSX/ZIP workbook.')
}

function readZipEntries(data: Buffer) {
  const eocd = findEndOfCentralDirectory(data)
  const entryCount = data.readUInt16LE(eocd + 10)
  const centralDirectoryOffset = data.readUInt32LE(eocd + 16)
  const entries = new Map<string, ZipEntry>()
  let offset = centralDirectoryOffset
  let totalUncompressed = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      throw new XlsxImportError('The XLSX archive directory is malformed.')
    }

    const flags = data.readUInt16LE(offset + 8)
    const compressionMethod = data.readUInt16LE(offset + 10)
    const compressedSize = data.readUInt32LE(offset + 20)
    const uncompressedSize = data.readUInt32LE(offset + 24)
    const fileNameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const localHeaderOffset = data.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + fileNameLength

    if (nameEnd > data.length) throw new XlsxImportError('The XLSX archive contains an invalid entry name.')
    const rawName = data.subarray(nameStart, nameEnd).toString('utf8').replace(/\\/g, '/')
    const normalizedName = path.posix.normalize(rawName).replace(/^\/+/, '')
    if (!normalizedName || normalizedName.startsWith('../')) {
      throw new XlsxImportError('The XLSX archive contains an unsafe entry path.')
    }
    if ((flags & 0x1) !== 0) throw new XlsxImportError('Encrypted XLSX workbooks are not supported.')
    if (![0, 8].includes(compressionMethod)) {
      throw new XlsxImportError(`Unsupported XLSX compression method ${compressionMethod}.`)
    }

    totalUncompressed += uncompressedSize
    if (totalUncompressed > XLSX_LIMITS.maxUncompressedBytes) {
      throw new XlsxImportError('The XLSX workbook expands beyond the allowed size limit.', 'XLSX_TOO_LARGE')
    }

    entries.set(normalizedName, {
      name: normalizedName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      flags,
    })

    offset = nameEnd + extraLength + commentLength
  }

  return entries
}

function extractEntry(data: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset
  if (offset + 30 > data.length || data.readUInt32LE(offset) !== 0x04034b50) {
    throw new XlsxImportError(`XLSX entry ${entry.name} has an invalid local header.`)
  }
  const fileNameLength = data.readUInt16LE(offset + 26)
  const extraLength = data.readUInt16LE(offset + 28)
  const start = offset + 30 + fileNameLength + extraLength
  const end = start + entry.compressedSize
  if (end > data.length) throw new XlsxImportError(`XLSX entry ${entry.name} is truncated.`)

  const compressed = data.subarray(start, end)
  const content = entry.compressionMethod === 0 ? Buffer.from(compressed) : inflateRawSync(compressed)
  if (content.length !== entry.uncompressedSize) {
    throw new XlsxImportError(`XLSX entry ${entry.name} has an unexpected uncompressed size.`)
  }
  return content
}

function readEntryText(data: Buffer, entries: Map<string, ZipEntry>, name: string): string
function readEntryText(data: Buffer, entries: Map<string, ZipEntry>, name: string, required: true): string
function readEntryText(data: Buffer, entries: Map<string, ZipEntry>, name: string, required: false): string | null
function readEntryText(data: Buffer, entries: Map<string, ZipEntry>, name: string, required = true): string | null {
  const entry = entries.get(name)
  if (!entry) {
    if (!required) return null
    throw new XlsxImportError(`Required XLSX entry ${name} is missing.`)
  }
  return extractEntry(data, entry).toString('utf8')
}

function relationshipTargets(xml: string) {
  const result = new Map<string, string>()
  for (const match of xml.matchAll(/<Relationship\b([^>]*?)(?:\/>|>)/g)) {
    const id = attribute(match[1], 'Id')
    const target = attribute(match[1], 'Target')
    if (id && target) result.set(id, target)
  }
  return result
}

function resolveWorkbookTarget(target: string) {
  const cleaned = target.replace(/\\/g, '/').replace(/^\/+/, '')
  const resolved = path.posix.normalize(path.posix.join('xl', cleaned))
  if (resolved.startsWith('../')) throw new XlsxImportError('The workbook contains an unsafe worksheet target.')
  return resolved
}

function workbookSheets(workbookXml: string, relations: Map<string, string>) {
  const sheets: Array<{ name: string; entryName: string }> = []
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)(?:\/>|>)/g)) {
    const name = attribute(match[1], 'name')
    const relationshipId = attribute(match[1], 'r:id')
    if (!name || !relationshipId) continue
    const target = relations.get(relationshipId)
    if (!target) throw new XlsxImportError(`Worksheet ${name} has no workbook relationship target.`)
    sheets.push({ name, entryName: resolveWorkbookTarget(target) })
  }
  return sheets
}

function sharedStrings(xml: string | null) {
  if (!xml) return []
  const values: string[] = []
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const fragments: string[] = []
    for (const textMatch of match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      fragments.push(decodeXml(textMatch[1]))
    }
    values.push(fragments.join(''))
  }
  return values
}

function columnIndexFromReference(reference: string) {
  const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase()
  if (!letters) return null
  let result = 0
  for (const character of letters) result = result * 26 + character.charCodeAt(0) - 64
  return result - 1
}

function textFragments(cellBody: string) {
  const fragments: string[] = []
  for (const match of cellBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    fragments.push(decodeXml(match[1]))
  }
  return fragments.join('')
}

function valueTag(cellBody: string) {
  const match = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
  return match ? decodeXml(match[1]) : ''
}

function cellValue(type: string | null, body: string, strings: string[]) {
  if (type === 'inlineStr') return textFragments(body)
  const value = valueTag(body)
  if (type === 's') {
    const index = Number.parseInt(value, 10)
    return Number.isInteger(index) && index >= 0 && index < strings.length ? strings[index] : ''
  }
  if (type === 'b') return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value
  return value
}

function parseWorksheet(xml: string, strings: string[], name: string): XlsxSheet {
  const rows: XlsxRow[] = []
  let highestColumn = 0

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumberValue = attribute(rowMatch[1], 'r')
    const rowNumber = rowNumberValue ? Number.parseInt(rowNumberValue, 10) : rows.length + 1
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue
    if (rowNumber > XLSX_LIMITS.maxRowsPerSheet) {
      throw new XlsxImportError(
        `Worksheet “${name}” exceeds the ${XLSX_LIMITS.maxRowsPerSheet}-row import limit.`,
        'XLSX_TOO_MANY_ROWS',
      )
    }

    const values: string[] = []
    let inferredColumn = 0
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = attribute(cellMatch[1], 'r')
      const columnIndex = reference ? columnIndexFromReference(reference) : inferredColumn
      if (columnIndex === null) continue
      if (columnIndex >= XLSX_LIMITS.maxColumnsPerSheet) {
        throw new XlsxImportError(
          `Worksheet “${name}” exceeds the ${XLSX_LIMITS.maxColumnsPerSheet}-column import limit.`,
          'XLSX_TOO_MANY_COLUMNS',
        )
      }
      const type = attribute(cellMatch[1], 't')
      values[columnIndex] = cellValue(type, cellMatch[2] ?? '', strings)
      inferredColumn = columnIndex + 1
      highestColumn = Math.max(highestColumn, columnIndex + 1)
    }

    if (values.some((value) => value !== undefined && value !== '')) {
      rows.push({ rowNumber, values: Array.from({ length: highestColumn }, (_unused, index) => values[index] ?? '') })
    }
  }

  for (const row of rows) {
    if (row.values.length < highestColumn) {
      row.values = Array.from({ length: highestColumn }, (_unused, index) => row.values[index] ?? '')
    }
  }

  return {
    name,
    rowCount: rows.length > 0 ? rows[rows.length - 1].rowNumber : 0,
    columnCount: highestColumn,
    rows,
  }
}

export function readXlsxWorkbook(input: ArrayBuffer | Buffer): XlsxWorkbook {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (data.length === 0) throw new XlsxImportError('The uploaded XLSX file is empty.')
  if (data.length > XLSX_LIMITS.maxFileBytes) {
    throw new XlsxImportError(
      `XLSX files are limited to ${Math.floor(XLSX_LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
      'XLSX_TOO_LARGE',
    )
  }

  const entries = readZipEntries(data)
  const workbookXml = readEntryText(data, entries, 'xl/workbook.xml')
  const relationshipsXml = readEntryText(data, entries, 'xl/_rels/workbook.xml.rels')
  const strings = sharedStrings(readEntryText(data, entries, 'xl/sharedStrings.xml', false))
  const sheets = workbookSheets(workbookXml, relationshipTargets(relationshipsXml))

  if (sheets.length === 0) throw new XlsxImportError('The XLSX workbook does not contain any worksheets.')
  if (sheets.length > XLSX_LIMITS.maxSheets) {
    throw new XlsxImportError(
      `XLSX workbooks are limited to ${XLSX_LIMITS.maxSheets} worksheets.`,
      'XLSX_TOO_MANY_SHEETS',
    )
  }

  return {
    sheets: sheets.map((sheet) => {
      const xml = readEntryText(data, entries, sheet.entryName)
      return parseWorksheet(xml, strings, sheet.name)
    }),
  }
}
