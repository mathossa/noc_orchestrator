import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { firmwareLifecycleApiError } from '@/lib/firmware-lifecycle-api'
import {
  clearFirmwareLifecycleDecision,
  setFirmwareLifecycleDecision,
} from '@/lib/firmware-lifecycle-store'
import { getDevice } from '@/lib/device-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    const session = await auth.api.getSession({ headers: request.headers })
    await setFirmwareLifecycleDecision(id, body, session?.user.id ?? null)
    return NextResponse.json({ data: await getDevice(id) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return firmwareLifecycleApiError(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    await clearFirmwareLifecycleDecision(id)
    return NextResponse.json({ data: await getDevice(id) })
  } catch (error) {
    return firmwareLifecycleApiError(error)
  }
}
