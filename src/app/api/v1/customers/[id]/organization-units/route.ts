import { withAdmin } from '@/lib/api-route-guard'
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import {
  listOrganizationUnits,
  createOrganizationUnit,
} from '@/lib/organization-unit-store'
type Context = { params: Promise<{ id: string }> }
async function GETHandler(request: Request, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({
      data: await listOrganizationUnits(
        id,
        new URL(request.url).searchParams.get('q') ?? '',
      ),
    })
  } catch (error) {
    return siteApiError(error)
  }
}
async function POSTHandler(request: Request, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(
      {
        data: await createOrganizationUnit(
          id,
          await request.json(),
          (await auth.api.getSession({ headers: request.headers }))?.user.id ??
            null,
        ),
      },
      { status: 201 },
    )
  } catch (error) {
    return siteApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
