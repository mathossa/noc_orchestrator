import { NextResponse } from 'next/server'
import { inspectImporterV2Xlsx } from '@/lib/importer-v2-ingestion-store'
import { XlsxImportError } from '@/lib/xlsx-reader'

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'XLSX_FILE_REQUIRED', message: 'Choose an XLSX workbook.' } },
        { status: 400 },
      )
    }
    const provider = text(formData.get('provider'))
    const sourceAdapterId = text(formData.get('sourceAdapterId'))
    const data = await inspectImporterV2Xlsx({ file, provider, sourceAdapterId })
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The XLSX workbook could not be inspected.'
    return NextResponse.json(
      {
        error: {
          code: error instanceof XlsxImportError ? error.code : 'IMPORTER_V2_XLSX_INSPECTION_FAILED',
          message,
        },
      },
      { status: 400 },
    )
  }
}
