import { NextResponse } from 'next/server'
import { deviceModelFamilyApiError } from '@/lib/model-family-api'
import {
  deleteDeviceModelFamily,
  getDeviceModelFamily,
  updateDeviceModelFamily,
} from '@/lib/model-family-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    return NextResponse.json({ data: await getDeviceModelFamily(id) })
  } catch (error) {
    return deviceModelFamilyApiError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await updateDeviceModelFamily(id, body) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return deviceModelFamilyApiError(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    await deleteDeviceModelFamily(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return deviceModelFamilyApiError(error)
  }
}
