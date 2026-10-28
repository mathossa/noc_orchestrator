import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { firmwareDrilldownApiError } from '@/lib/firmware-drilldown-api'
import { getContractDrilldown } from '@/lib/firmware-drilldown-store'

type RouteContext = { params: Promise<{ id: string }> }

async function GETHandler(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    return NextResponse.json({ data: await getContractDrilldown(id) })
  } catch (error) {
    return firmwareDrilldownApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
