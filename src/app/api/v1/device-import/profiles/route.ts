import { NextResponse } from 'next/server'
import {
  DeviceImportProfileError,
  listDeviceImportProfiles,
  saveDeviceImportProfile,
} from '@/lib/device-import-profile-store'
import { DeviceImportValidationError } from '@/lib/device-import'

export async function GET() {
  try {
    return NextResponse.json({ data: await listDeviceImportProfiles() })
  } catch (error) {
    console.error('Failed to list device import profiles', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Import profiles could not be loaded.' } },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ data: await saveDeviceImportProfile(body) }, { status: 200 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    if (error instanceof DeviceImportProfileError || error instanceof DeviceImportValidationError) {
      return NextResponse.json({ error: { code: 'INVALID_PROFILE', message: error.message } }, { status: 400 })
    }
    console.error('Failed to save device import profile', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The import profile could not be saved.' } },
      { status: 500 },
    )
  }
}
