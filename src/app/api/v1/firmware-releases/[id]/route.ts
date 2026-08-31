import { NextResponse } from 'next/server'
import { firmwareReleaseApiError } from '@/lib/firmware-release-api'
import { deleteFirmwareRelease, getFirmwareRelease, updateFirmwareRelease } from '@/lib/firmware-release-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    return NextResponse.json({ data: await getFirmwareRelease(id) })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await request.json()
    return NextResponse.json({ data: await updateFirmwareRelease(id, body) })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    await deleteFirmwareRelease(id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}
