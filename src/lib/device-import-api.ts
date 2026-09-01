import { NextResponse } from 'next/server'
import { DeviceImportValidationError, parseDeviceImportOptions } from '@/lib/device-import'
import { XLSX_LIMITS, XlsxImportError } from '@/lib/xlsx-reader'

export function deviceImportApiError(error: unknown) {
  if (error instanceof XlsxImportError) {
    const status = error.code.includes('TOO_LARGE') ? 413 : 400
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status })
  }
  if (error instanceof DeviceImportValidationError) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 })
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return NextResponse.json(
      { error: { code: 'IMPORT_CONFLICT', message: 'Inventory changed since the preview. Refresh the import preview and try again.' } },
      { status: 409 },
    )
  }

  console.error('Device XLSX import failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The XLSX device import could not be completed.' } },
    { status: 500 },
  )
}

export async function xlsxFileFromRequest(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) throw new DeviceImportValidationError('Choose an XLSX file to import.')
  if (!file.name.toLocaleLowerCase('en-US').endsWith('.xlsx')) {
    throw new DeviceImportValidationError('Only .xlsx workbooks are supported for this import.')
  }
  if (file.size <= 0) throw new DeviceImportValidationError('The selected XLSX file is empty.')
  if (file.size > XLSX_LIMITS.maxFileBytes) {
    throw new XlsxImportError(
      `XLSX files are limited to ${Math.floor(XLSX_LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
      'XLSX_TOO_LARGE',
    )
  }
  return { formData, file, buffer: Buffer.from(await file.arrayBuffer()) }
}

export function optionsFromFormData(formData: FormData) {
  const value = formData.get('options')
  if (typeof value !== 'string') throw new DeviceImportValidationError('Import mapping options are required.')
  try {
    return parseDeviceImportOptions(JSON.parse(value))
  } catch (error) {
    if (error instanceof SyntaxError) throw new DeviceImportValidationError('Import mapping options are malformed.')
    throw error
  }
}

export function selectedRowsFromFormData(formData: FormData) {
  const value = formData.get('selectedRows')
  if (typeof value !== 'string') throw new DeviceImportValidationError('Choose one or more preview rows to import.')
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new DeviceImportValidationError('Selected import rows are malformed.')
  }
}
