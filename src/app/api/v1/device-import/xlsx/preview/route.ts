import { NextResponse } from 'next/server'
import { deviceImportApiError, optionsFromFormData, xlsxFileFromRequest } from '@/lib/device-import-api'
import { previewDeviceImport } from '@/lib/device-import-store'
import { readXlsxWorkbook } from '@/lib/xlsx-reader'

export const runtime = 'nodejs'

const CLIENT_PREVIEW_ROW_LIMIT = 200
const UNRESOLVED_ROW_SAMPLE_LIMIT = 25

export async function POST(request: Request) {
  try {
    const { formData, file, buffer } = await xlsxFileFromRequest(request)
    const options = optionsFromFormData(formData)
    const workbook = readXlsxWorkbook(buffer)
    const preview = await previewDeviceImport(workbook, options, file.name)
    const totalRows = preview.counts.create + preview.counts.update + preview.counts.unchanged + preview.counts.conflict + preview.counts.error

    return NextResponse.json({
      data: {
        ...preview,
        rows: preview.rows.slice(0, CLIENT_PREVIEW_ROW_LIMIT),
        unresolvedReferences: preview.unresolvedReferences.map((reference) => ({
          ...reference,
          totalRows: reference.rowNumbers.length,
          rowNumbers: reference.rowNumbers.slice(0, UNRESOLVED_ROW_SAMPLE_LIMIT),
        })),
        totalRows,
        previewRowLimit: CLIENT_PREVIEW_ROW_LIMIT,
        rowsTruncated: totalRows > CLIENT_PREVIEW_ROW_LIMIT,
      },
    })
  } catch (error) {
    return deviceImportApiError(error)
  }
}
