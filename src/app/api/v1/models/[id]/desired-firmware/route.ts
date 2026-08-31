import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getDeviceModel } from '@/lib/device-model-store'
import { firmwarePolicyApiError } from '@/lib/firmware-policy-api'
import { clearModelDesiredFirmwarePolicy, setModelDesiredFirmwarePolicy } from '@/lib/firmware-policy-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = (await request.json()) as { firmwareReleaseId?: unknown }
    const session = await auth.api.getSession({ headers: request.headers })
    await setModelDesiredFirmwarePolicy(id, body.firmwareReleaseId, session?.user.id ?? null)
    return NextResponse.json({ data: await getDeviceModel(id) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return firmwarePolicyApiError(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    await clearModelDesiredFirmwarePolicy(id, session?.user.id ?? null)
    return NextResponse.json({ data: await getDeviceModel(id) })
  } catch (error) {
    return firmwarePolicyApiError(error)
  }
}
