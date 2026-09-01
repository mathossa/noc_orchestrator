import { NextResponse } from 'next/server'
import { detectHeaderRow, headersFromRow, suggestColumnMapping } from '@/lib/device-import'
import { deviceImportApiError, xlsxFileFromRequest } from '@/lib/device-import-api'
import { listDeviceReferences } from '@/lib/device-store'
import { readXlsxWorkbook, XLSX_LIMITS } from '@/lib/xlsx-reader'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const { file, buffer } = await xlsxFileFromRequest(request)
    const [workbook, references] = await Promise.all([
      Promise.resolve(readXlsxWorkbook(buffer)),
      listDeviceReferences(),
    ])

    const sheets = workbook.sheets.map((sheet) => {
      const previewRows = sheet.rows.slice(0, XLSX_LIMITS.previewRows)
      const detectedHeaderRow = detectHeaderRow(previewRows)
      const header = previewRows.find((row) => row.rowNumber === detectedHeaderRow)
      const headers = headersFromRow(header, sheet.columnCount)
      return {
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        previewRows,
        detectedHeaderRow,
        headers,
        suggestedMapping: suggestColumnMapping(headers),
      }
    })

    return NextResponse.json({
      data: {
        fileName: file.name,
        fileSize: file.size,
        sheets,
        limits: XLSX_LIMITS,
      },
      references: {
        customers: references.customers,
        sites: references.sites,
      },
    })
  } catch (error) {
    return deviceImportApiError(error)
  }
}
