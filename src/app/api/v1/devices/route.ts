import { NextResponse } from 'next/server'
import { deviceApiError } from '@/lib/device-api'
import { createDevice, listDeviceReferences, listDevices } from '@/lib/device-store'

export async function GET() {
  try {
    const [data, meta] = await Promise.all([listDevices(), listDeviceReferences()])
    return NextResponse.json({ data, meta })
  } catch (error) {
    return deviceApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ data: await createDevice(body) }, { status: 201 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return deviceApiError(error)
  }
}
