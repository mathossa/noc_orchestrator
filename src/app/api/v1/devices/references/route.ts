import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { deviceApiError } from '@/lib/device-api'
import { listDeviceReferences } from '@/lib/device-store'

async function GETHandler() {
  try {
    return NextResponse.json({ data: await listDeviceReferences() })
  } catch (error) {
    return deviceApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
