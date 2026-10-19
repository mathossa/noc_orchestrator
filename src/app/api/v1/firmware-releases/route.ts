import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { firmwareReleaseApiError } from '@/lib/firmware-release-api'
import {
  createFirmwareRelease,
  listFirmwareReleases,
  listFirmwareTrainReferences,
  listFirmwareVendors,
} from '@/lib/firmware-release-store'

async function GETHandler() {
  try {
    const [releases, vendors, trains] = await Promise.all([
      listFirmwareReleases(),
      listFirmwareVendors(),
      listFirmwareTrainReferences(),
    ])
    return NextResponse.json({ data: releases, meta: { vendors, trains } })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}

async function POSTHandler(request: Request) {
  try {
    const body = await request.json()
    const release = await createFirmwareRelease(body)
    return NextResponse.json({ data: release }, { status: 201 })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
