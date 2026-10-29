import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { requireAdminRequest } from '@/lib/api-admin'
import { documentationApiError } from '../../documentation-api-error'
import { createReleaseDocumentation, listReleaseDocumentation } from '@/lib/firmware-release-documentation-store'

type RouteContext = { params: Promise<{ id: string }> }

async function GETHandler(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    return NextResponse.json(await listReleaseDocumentation(id))
  } catch (error) {
    return documentationApiError(error)
  }
}

async function POSTHandler(request: Request, { params }: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { id } = await params
    const data = await createReleaseDocumentation(id, await request.json())
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return documentationApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
