import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
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
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({ data: await createDevice(body, session?.user.id ?? null) }, { status: 201 })
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
