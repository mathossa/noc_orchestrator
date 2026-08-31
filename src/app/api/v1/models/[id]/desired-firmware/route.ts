import { NextResponse } from 'next/server'
import { getDeviceModel } from '@/lib/device-model-store'
import { firmwarePolicyApiError } from '@/lib/firmware-policy-api'
import { clearModelDesiredFirmwarePolicy, setModelDesiredFirmwarePolicy } from '@/lib/firmware-policy-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = (await request.json()) as { firmwareReleaseId?: unknown }
    await setModelDesiredFirmwarePolicy(id, body.firmwareReleaseId)
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

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    await clearModelDesiredFirmwarePolicy(id)
    return NextResponse.json({ data: await getDeviceModel(id) })
  } catch (error) {
    return firmwarePolicyApiError(error)
  }
}
