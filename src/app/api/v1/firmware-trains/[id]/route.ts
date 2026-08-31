import { NextResponse } from 'next/server'
import { firmwareTrainApiError } from '@/lib/firmware-train-api'
import { deleteFirmwareTrain, getFirmwareTrain, updateFirmwareTrain } from '@/lib/firmware-train-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    return NextResponse.json({ data: await getFirmwareTrain(id) })
  } catch (error) {
    return firmwareTrainApiError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()
    return NextResponse.json({ data: await updateFirmwareTrain(id, body) })
  } catch (error) {
    return firmwareTrainApiError(error)
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    await deleteFirmwareTrain(id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return firmwareTrainApiError(error)
  }
}
