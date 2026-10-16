import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { deviceApiError } from '@/lib/device-api'
import { parseDeviceQuery } from '@/lib/device-query'
import { queryDevices } from '@/lib/device-query-store'
import { createDevice } from '@/lib/device-store'

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 })
    }
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required.' } }, { status: 403 })
    }
    const query = parseDeviceQuery(new URL(request.url).searchParams)
    return NextResponse.json(await queryDevices(query))
  } catch (error) {
    return deviceApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 })
    }
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required.' } }, { status: 403 })
    }
    const body = await request.json()
    return NextResponse.json({ data: await createDevice(body, session.user.id) }, { status: 201 })
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
