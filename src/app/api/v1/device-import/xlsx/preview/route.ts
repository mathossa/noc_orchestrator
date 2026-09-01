import { NextResponse } from 'next/server'
import { deviceImportApiError, optionsFromFormData, xlsxFileFromRequest } from '@/lib/device-import-api'
import { previewDeviceImport } from '@/lib/device-import-store'
import { readXlsxWorkbook } from '@/lib/xlsx-reader'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const { formData, file, buffer } = await xlsxFileFromRequest(request)
    const options = optionsFromFormData(formData)
    const workbook = readXlsxWorkbook(buffer)
    return NextResponse.json({ data: await previewDeviceImport(workbook, options, file.name) })
  } catch (error) {
    return deviceImportApiError(error)
  }
}
