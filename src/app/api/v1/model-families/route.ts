import { NextResponse } from 'next/server'
import { deviceModelFamilyApiError } from '@/lib/model-family-api'
import { createDeviceModelFamily, listDeviceModelFamilies } from '@/lib/model-family-store'

export async function GET() {
  try {
    return NextResponse.json({ data: await listDeviceModelFamilies() })
  } catch (error) {
    return deviceModelFamilyApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ data: await createDeviceModelFamily(body) }, { status: 201 })
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
