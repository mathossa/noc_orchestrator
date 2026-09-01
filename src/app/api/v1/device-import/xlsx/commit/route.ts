import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  deviceImportApiError,
  optionsFromFormData,
  selectedRowsFromFormData,
  xlsxFileFromRequest,
} from '@/lib/device-import-api'
import { commitDeviceImport } from '@/lib/device-import-store'
import { readXlsxWorkbook } from '@/lib/xlsx-reader'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const { formData, file, buffer } = await xlsxFileFromRequest(request)
    const options = optionsFromFormData(formData)
    const selectedRows = selectedRowsFromFormData(formData)
    const session = await auth.api.getSession({ headers: request.headers })
    const workbook = readXlsxWorkbook(buffer)
    return NextResponse.json({
      data: await commitDeviceImport(workbook, options, selectedRows, file.name, session?.user.id ?? null),
    })
  } catch (error) {
    return deviceImportApiError(error)
  }
}
