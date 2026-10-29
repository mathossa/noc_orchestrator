import { withAdmin } from '@/lib/api-route-guard'
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { deleteSite, getSite, updateSite } from '@/lib/site-store'

type RouteContext = { params: Promise<{ id: string; siteId: string }> }

async function GETHandler(_request: Request, context: RouteContext) {
  const { id, siteId } = await context.params
  try {
    return NextResponse.json({ data: await getSite(id, siteId) })
  } catch (error) {
    return siteApiError(error)
  }
}

async function PATCHHandler(request: Request, context: RouteContext) {
  const { id, siteId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await updateSite(id, siteId, body, (await auth.api.getSession({ headers: request.headers }))?.user.id ?? null) })
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

async function DELETEHandler(_request: Request, context: RouteContext) {
  const { id, siteId } = await context.params
  try {
    await deleteSite(id, siteId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return siteApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const PATCH = withAdmin(PATCHHandler)
export const DELETE = withAdmin(DELETEHandler)
