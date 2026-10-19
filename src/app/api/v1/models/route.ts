import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { deviceModelApiError } from '@/lib/device-model-api'
import { createDeviceModel, listDeviceModelReferences, listDeviceModels } from '@/lib/device-model-store'

async function GETHandler() {
  try {
    const [data, references] = await Promise.all([listDeviceModels(), listDeviceModelReferences()])
    return NextResponse.json({ data, references })
  } catch (error) {
    return deviceModelApiError(error)
  }
}

async function POSTHandler(request: Request) {
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

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
