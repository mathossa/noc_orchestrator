// SPDX-License-Identifier: AGPL-3.0-only
import archiver from 'archiver'
import {
  buildContractReportSections,
  type ContractReportDefinition,
} from '@/lib/inventory-contract-report'
import { buildInventoryReport } from '@/lib/inventory-report'
import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'

const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships'

function xml(value: string | number) {
  // Spreadsheet cells have a 32,767-character limit; remove invalid XML 1.0 controls.
  const safe = String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 32767)
  const escapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }
  return safe.replace(/[&<>"']/g, (character) => escapes[character])
}

function cell(column: string, row: number, value: string | number, style = 0) {
  const ref = column + row
  if (typeof value === 'number') {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`
  }
  // Use explicit inline strings; attacker-controlled device names are never formulas.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
}

const columns = [
  ['A', 'Device', 30],
  ['B', 'Site', 25],
  ['C', 'Model', 23],
  ['D', 'Serial', 25],
  ['E', 'Running firmware', 21],
  ['F', 'Preferred target', 22],
  ['G', 'Management contract', 26],
  ['H', 'Status', 28],
] as const

type InventoryWorksheetTable = {
  id: number
  name: string
  ref: string
  relationshipId: string
  xml: string
}

function excelSheetNameBase(title: string) {
  // Excel limits worksheet names to 31 chars and rejects \ / * ? : [ ].
  const cleaned = title
    .normalize('NFKC')
    .replace(/[\\/*?:[\]]/g, '-')
    .replace(/^'+|'+$/g, '')
    .trim()
  return (cleaned || 'Report').slice(0, 31)
}

export function excelSheetNames(titles: string[]) {
  const used = new Set<string>()
  return titles.map((title) => {
    const base = excelSheetNameBase(title)
    let candidate = base
    let counter = 2
    while (used.has(candidate.toLocaleLowerCase('en-US'))) {
      const suffix = ` (${counter})`
      candidate = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix
      counter++
    }
    used.add(candidate.toLocaleLowerCase('en-US'))
    return candidate
  })
}

function customerTableXml(input: {
  id: number
  name: string
  ref: string
}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="${spreadsheetNs}" id="${input.id}" name="${input.name}" displayName="${input.name}" ref="${input.ref}" totalsRowShown="0">
  <autoFilter ref="${input.ref}"/>
  <tableColumns count="${columns.length}">
    ${columns.map(([, label], index) => `<tableColumn id="${index + 1}" name="${xml(label)}"/>`).join('')}
  </tableColumns>
  <tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>
</table>`
}

function worksheetRelationshipsXml(tables: InventoryWorksheetTable[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${packageRelationshipNs}">
${tables.map((table) => `<Relationship Id="${table.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${table.id}.xml"/>`).join('')}
</Relationships>`
}

function buildInventoryWorksheet(
  devices: InventoryExportRecord[],
  category: string,
  generatedAt: string,
  scopeDescription: string,
  firstTableId = 1,
) {
  // The caller provides the rows for exactly one configured report section.
  const report = buildInventoryReport(devices)

  let rowNumber = 0
  let nextTableId = firstTableId
  const rows: string[] = []
  const merges: string[] = []
  const tables: InventoryWorksheetTable[] = []
  const line = (cells: string[], style?: { height?: number }) => {
    rowNumber++
    rows.push(`<row r="${rowNumber}"${style?.height ? ` ht="${style.height}" customHeight="1"` : ''}>${cells.join('')}</row>`)
    return rowNumber
  }
  const heading = (text: string, style: number, height: number) => {
    const row = rowNumber + 1
    line([cell('A', row, text, style)], { height })
    merges.push(`<mergeCell ref="A${row}:H${row}"/>`)
  }

  heading('Firmware inventory report — ' + category, 1, 33)
  heading('Scope: ' + scopeDescription, 4, 22)
  heading('Generated: ' + generatedAt + '  |  Devices: ' + report.deviceCount +
    '  |  Customers: ' + report.customerCount, 4, 21)
  line([])

  if (!report.customers.length) heading('No matching devices for this contract category', 2, 27)

  for (const customer of report.customers) {
    heading(customer.name + '  (' + customer.deviceCount + ' devices)', 2, 29)
    const headerRow = rowNumber + 1
    line(columns.map(([column, label]) => cell(column, headerRow, label, 3)), { height: 25 })
    for (const site of customer.sites) {
      for (const device of site.devices) {
        const n = rowNumber + 1
        const values = [
          device.name, site.name, device.model, device.serialNumber,
          device.currentFirmware || 'Unknown', device.effectiveTarget || 'Unresolved',
          device.contract || 'No contract', device.primaryStatus,
        ]
        line(columns.map(([column], i) => cell(column, n, values[i])), { height: 22 })
      }
    }

    const lastDataRow = rowNumber
    if (lastDataRow > headerRow) {
      const id = nextTableId++
      const name = `InventoryTable${id}`
      const ref = `A${headerRow}:H${lastDataRow}`
      const relationshipId = `rId${tables.length + 1}`
      tables.push({
        id,
        name,
        ref,
        relationshipId,
        xml: customerTableXml({ id, name, ref }),
      })
    }
    line([])
  }

  const tableParts = tables.length
    ? `<tableParts count="${tables.length}">${tables.map((table) => `<tablePart r:id="${table.relationshipId}"/>`).join('')}</tableParts>`
    : ''

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${spreadsheetNs}" xmlns:r="${relationshipNs}">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns.map(([, , width], i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${rows.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.join('')}</mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  ${tableParts}
</worksheet>`

  return { xml: worksheetXml, tables, nextTableId }
}

export function inventoryWorksheetXml(
  devices: InventoryExportRecord[],
  category: string,
  generatedAt: string,
  scopeDescription: string,
): string {
  return buildInventoryWorksheet(
    devices,
    category,
    generatedAt,
    scopeDescription,
  ).xml
}

function workbookStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${spreadsheetNs}">
  <fonts count="4">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>
    <font><b/><sz val="13"/><color rgb="FF202020"/><name val="Aptos"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFAB5F20"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF333333"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4E9DD"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

export function inventoryWorkbookParts(
  devices: InventoryExportRecord[],
  generatedAt: string,
  scopeDescription: string,
  configuredContracts: ContractReportDefinition[] = [],
) {
  const sections = buildContractReportSections(devices, configuredContracts)
  const safeNames = excelSheetNames(sections.map((section) => section.title))
  let nextTableId = 1
  const sheets = sections.map((section, index) => {
    const worksheet = buildInventoryWorksheet(
      section.report.devices,
      section.title,
      generatedAt,
      scopeDescription,
      nextTableId,
    )
    nextTableId = worksheet.nextTableId
    return {
      name: safeNames[index],
      title: section.title,
      file: `xl/worksheets/sheet${index + 1}.xml`,
      relationshipFile: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
      xml: worksheet.xml,
      tables: worksheet.tables,
    }
  })
  const tables = sheets.flatMap((sheet) => sheet.tables)

  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((sheet, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
  ${tables.map((table) => `<Override PartName="/xl/tables/table${table.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join('')}
</Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${packageRelationshipNs}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${spreadsheetNs}" xmlns:r="${relationshipNs}">
<sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${packageRelationshipNs}">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  return [
    { name: '[Content_Types].xml', content: types },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: workbookStylesXml() },
    ...sheets.flatMap((sheet) => [
      { name: sheet.file, content: sheet.xml },
      ...(sheet.tables.length
        ? [{
            name: sheet.relationshipFile,
            content: worksheetRelationshipsXml(sheet.tables),
          }]
        : []),
    ]),
    ...tables.map((table) => ({
      name: `xl/tables/table${table.id}.xml`,
      content: table.xml,
    })),
  ]
}

/** Uses existing MIT-licensed archiver rather than adding a second zip engine. */
export async function inventoryReportXlsx(
  devices: InventoryExportRecord[],
  generatedAt: string,
  scopeDescription: string,
  configuredContracts: ContractReportDefinition[] = [],
): Promise<Buffer> {
  const zip = archiver('zip', { zlib: { level: 6 } })
  const chunks: Buffer[] = []
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    zip.once('error', reject)
    zip.once('end', () => resolve(Buffer.concat(chunks)))
  })
  for (const part of inventoryWorkbookParts(
    devices,
    generatedAt,
    scopeDescription,
    configuredContracts,
  )) {
    zip.append(part.content, { name: part.name })
  }
  await zip.finalize()
  return result
}
