import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { deleteSite, getSite, updateSite } from '@/lib/site-store'

type RouteContext = { params: Promise<{ id: string; siteId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { id, siteId } = await context.params
  try {
    return NextResponse.json({ data: await getSite(id, siteId) })
  } catch (error) {
    return siteApiError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id, siteId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await updateSite(id, siteId, body) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return siteApiError(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, siteId } = await context.params
  try {
    await deleteSite(id, siteId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return siteApiError(error)
  }
}
