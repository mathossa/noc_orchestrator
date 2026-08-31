import { NextResponse } from 'next/server'
import { firmwareReleaseApiError } from '@/lib/firmware-release-api'
import { createFirmwareRelease, listFirmwareReleases, listFirmwareVendors } from '@/lib/firmware-release-store'

export async function GET() {
  try {
    const [releases, vendors] = await Promise.all([listFirmwareReleases(), listFirmwareVendors()])
    return NextResponse.json({ data: releases, meta: { vendors } })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const release = await createFirmwareRelease(body)
    return NextResponse.json({ data: release }, { status: 201 })
  } catch (error) {
    return firmwareReleaseApiError(error)
  }
}
