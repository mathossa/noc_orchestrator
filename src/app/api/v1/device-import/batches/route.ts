import { NextResponse } from 'next/server'
import { deviceImportApiError, optionsFromFormData, xlsxFileFromRequest } from '@/lib/device-import-api'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { applySavedImportProfileRules } from '@/lib/device-import-staged-rules'
import {
  createDeviceImportBatch,
  DeviceImportStagingError,
  getDeviceImportBatchWorkspace,
  listDeviceImportBatches,
} from '@/lib/device-import-staging-store'
import { readXlsxWorkbook } from '@/lib/xlsx-reader'

export const runtime = 'nodejs'

export async function GET() {
  try {
    return NextResponse.json({ data: await listDeviceImportBatches() })
  } catch (error) {
    console.error('Failed to list staged device imports', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Staged imports could not be loaded.' } },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const { formData, file, buffer } = await xlsxFileFromRequest(request)
    const options = optionsFromFormData(formData)
    const workbook = readXlsxWorkbook(buffer)
    const staged = await createDeviceImportBatch(workbook, options, file.name)
    await applySavedImportProfileRules(staged.batch.id)
    await synchronizeImportedModelPlatforms(staged.batch.id)
    await resolveStagedFirmwarePlatforms(staged.batch.id)
    const data = await getDeviceImportBatchWorkspace(staged.batch.id)
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    return deviceImportApiError(error)
  }
}
