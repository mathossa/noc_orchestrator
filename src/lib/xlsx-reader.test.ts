import { describe, expect, it } from 'vitest'
import { readXlsxWorkbook, XlsxImportError } from '@/lib/xlsx-reader'

function storedZip(files: Record<string, string>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const [name, text] of Object.entries(files)) {
    const fileName = Buffer.from(name)
    const content = Buffer.from(text)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, fileName, content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, fileName)

    localOffset += local.length + fileName.length + content.length
  }

  const locals = Buffer.concat(localParts)
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(locals.length, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([locals, centralDirectory, end])
}

function workbookWithSheet(sheetXml: string) {
  return storedZip({
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Devices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst><si><t>Hostname</t></si><si><t>Model</t></si><si><t>sw-01</t></si><si><t>2530-24G</t></si></sst>`,
    'xl/worksheets/sheet1.xml': sheetXml,
  })
}

function sampleWorkbook() {
  return workbookWithSheet(`<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="inlineStr"><is><t>16.11.0031</t></is></c></row></sheetData></worksheet>`)
}

describe('bounded XLSX reader', () => {
  it('reads worksheet names, shared strings and inline strings without an external XLSX runtime dependency', () => {
    const workbook = readXlsxWorkbook(sampleWorkbook())

    expect(workbook.sheets).toHaveLength(1)
    expect(workbook.sheets[0]).toMatchObject({ name: 'Devices', rowCount: 2, columnCount: 3 })
    expect(workbook.sheets[0].rows).toEqual([
      { rowNumber: 1, values: ['Hostname', 'Model', ''] },
      { rowNumber: 2, values: ['sw-01', '2530-24G', '16.11.0031'] },
    ])
  })

  it('accepts worksheet row coordinates beyond the former 5,000-row application cap', () => {
    const workbook = readXlsxWorkbook(workbookWithSheet(
      `<?xml version="1.0"?><worksheet><sheetData><row r="6001"><c r="A6001" t="inlineStr"><is><t>sw-6001</t></is></c></row></sheetData></worksheet>`,
    ))

    expect(workbook.sheets[0]).toMatchObject({ rowCount: 6001, columnCount: 1 })
    expect(workbook.sheets[0].rows[0]).toEqual({ rowNumber: 6001, values: ['sw-6001'] })
  })

  it('rejects malformed non-ZIP/XLSX input cleanly', () => {
    expect(() => readXlsxWorkbook(Buffer.from('not an xlsx'))).toThrow(XlsxImportError)
  })
})
