import { withAdmin } from '@/lib/api-route-guard'
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import {
  getOrganizationUnit,
  updateOrganizationUnit,
  deleteOrganizationUnit,
} from '@/lib/organization-unit-store'
type Context = { params: Promise<{ id: string; unitId: string }> }
async function GETHandler(_request: Request, context: Context) {
  try {
    const { id, unitId } = await context.params
    return NextResponse.json({ data: await getOrganizationUnit(id, unitId) })
  } catch (error) {
    return siteApiError(error)
  }
}
async function PATCHHandler(request: Request, context: Context) {
  try {
    const { id, unitId } = await context.params
    return NextResponse.json({
      data: await updateOrganizationUnit(
        id,
        unitId,
        await request.json(),
        (await auth.api.getSession({ headers: request.headers }))?.user.id ??
          null,
      ),
    })
  } catch (error) {
    return siteApiError(error)
  }
}
async function DELETEHandler(_request: Request, context: Context) {
  try {
    const { id, unitId } = await context.params
    await deleteOrganizationUnit(id, unitId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return siteApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const PATCH = withAdmin(PATCHHandler)
export const DELETE = withAdmin(DELETEHandler)
