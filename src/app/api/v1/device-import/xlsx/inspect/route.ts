import { NextResponse } from 'next/server'
import { detectHeaderRow, headersFromRow, suggestColumnMapping } from '@/lib/device-import'
import { deviceImportApiError, xlsxFileFromRequest } from '@/lib/device-import-api'
import { listDeviceImportProfiles } from '@/lib/device-import-profile-store'
import { listDeviceImportReferenceOptions } from '@/lib/device-import-reference-store'
import { listDeviceReferences } from '@/lib/device-store'
import { readXlsxWorkbook, XLSX_LIMITS } from '@/lib/xlsx-reader'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const { file, buffer } = await xlsxFileFromRequest(request)
    const [workbook, references, resolutionReferences, profiles] = await Promise.all([
      Promise.resolve(readXlsxWorkbook(buffer, { maxMaterializedRowsPerSheet: XLSX_LIMITS.previewRows })),
      listDeviceReferences(),
      listDeviceImportReferenceOptions(),
      listDeviceImportProfiles(),
    ])

    const sheets = workbook.sheets.map((sheet) => {
      const previewRows = sheet.rows
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
      profiles,
      references: {
        customers: references.customers,
        sites: references.sites,
        ...resolutionReferences,
      },
    })
  } catch (error) {
    return deviceImportApiError(error)
  }
}
