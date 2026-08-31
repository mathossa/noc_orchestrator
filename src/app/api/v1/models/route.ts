import { NextResponse } from 'next/server'
import { deviceModelApiError } from '@/lib/device-model-api'
import { createDeviceModel, listDeviceModelReferences, listDeviceModels } from '@/lib/device-model-store'

export async function GET() {
  try {
    const [data, references] = await Promise.all([listDeviceModels(), listDeviceModelReferences()])
    return NextResponse.json({ data, references })
  } catch (error) {
    return deviceModelApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ data: await createDeviceModel(body) }, { status: 201 })
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
