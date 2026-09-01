import { NextResponse } from 'next/server'
import { DeviceImportReferenceError, saveImportReferenceAlias } from '@/lib/device-import-reference-store'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ data: await saveImportReferenceAlias(body) }, { status: 201 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    if (error instanceof DeviceImportReferenceError) {
      return NextResponse.json(
        { error: { code: 'INVALID_IMPORT_REFERENCE', message: error.message } },
        { status: 400 },
      )
    }
    console.error('Import alias API failed', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The import alias could not be saved.' } },
      { status: 500 },
    )
  }
}
