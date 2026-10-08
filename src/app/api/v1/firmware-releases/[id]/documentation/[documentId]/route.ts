import { NextResponse } from 'next/server'
import { documentationApiError } from '../../../documentation-api-error'
import { deleteReleaseDocumentation, updateReleaseDocumentation } from '@/lib/firmware-release-documentation-store'

type RouteContext = { params: Promise<{ id: string; documentId: string }> }

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id, documentId } = await params
    return NextResponse.json({ data: await updateReleaseDocumentation(id, documentId, await request.json()) })
  } catch (error) {
    return documentationApiError(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id, documentId } = await params
    await deleteReleaseDocumentation(id, documentId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return documentationApiError(error)
  }
}
