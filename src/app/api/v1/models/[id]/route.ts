import { NextResponse } from 'next/server'
import { deviceModelApiError } from '@/lib/device-model-api'
import { deleteDeviceModel, getDeviceModel, updateDeviceModel } from '@/lib/device-model-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    return NextResponse.json({ data: await getDeviceModel(id) })
  } catch (error) {
    return deviceModelApiError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await updateDeviceModel(id, body) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return deviceModelApiError(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    await deleteDeviceModel(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return deviceModelApiError(error)
  }
}
