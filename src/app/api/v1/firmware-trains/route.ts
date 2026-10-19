import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { firmwareTrainApiError } from '@/lib/firmware-train-api'
import { createFirmwareTrain, listFirmwareTrains } from '@/lib/firmware-train-store'
import { listFirmwareVendors } from '@/lib/firmware-release-store'

async function GETHandler() {
  try {
    const [trains, vendors] = await Promise.all([listFirmwareTrains(), listFirmwareVendors()])
    return NextResponse.json({ data: trains, meta: { vendors } })
  } catch (error) {
    return firmwareTrainApiError(error)
  }
}

async function POSTHandler(request: Request) {
  try {
    const body = await request.json()
    const train = await createFirmwareTrain(body)
    return NextResponse.json({ data: train }, { status: 201 })
  } catch (error) {
    return firmwareTrainApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
