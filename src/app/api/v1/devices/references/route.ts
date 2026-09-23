import { NextResponse } from 'next/server'
import { deviceApiError } from '@/lib/device-api'
import { listDeviceReferences } from '@/lib/device-store'

export async function GET() {
  try {
    return NextResponse.json({ data: await listDeviceReferences() })
  } catch (error) {
    return deviceApiError(error)
  }
}
