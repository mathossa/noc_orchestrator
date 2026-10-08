import { NextResponse } from 'next/server'
import { documentationApiError } from '../../documentation-api-error'
import { createReleaseDocumentation, listReleaseDocumentation } from '@/lib/firmware-release-documentation-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    return NextResponse.json(await listReleaseDocumentation(id))
  } catch (error) {
    return documentationApiError(error)
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    const data = await createReleaseDocumentation(id, await request.json())
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return documentationApiError(error)
  }
}
