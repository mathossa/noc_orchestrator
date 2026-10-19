import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { requireAdminRequest } from '@/lib/api-admin'
import { documentationApiError } from '../../../documentation-api-error'
import { deleteReleaseDocumentation, updateReleaseDocumentation } from '@/lib/firmware-release-documentation-store'

type RouteContext = { params: Promise<{ id: string; documentId: string }> }

async function PATCHHandler(request: Request, { params }: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { id, documentId } = await params
    return NextResponse.json({ data: await updateReleaseDocumentation(id, documentId, await request.json()) })
  } catch (error) {
    return documentationApiError(error)
  }
}

async function DELETEHandler(request: Request, { params }: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { id, documentId } = await params
    await deleteReleaseDocumentation(id, documentId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return documentationApiError(error)
  }
}

export const PATCH = withAdmin(PATCHHandler)
export const DELETE = withAdmin(DELETEHandler)
