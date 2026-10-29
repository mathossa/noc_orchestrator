import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { createSite, listSiteContractTypes, listSitesForCustomer } from '@/lib/site-store'

type RouteContext = { params: Promise<{ id: string }> }

async function GETHandler(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const [sites, contractTypes] = await Promise.all([
      listSitesForCustomer(id, new URL(_request.url).searchParams.get('organizationUnit') ?? undefined),
      listSiteContractTypes(),
    ])
    return NextResponse.json({ data: sites, contractTypes })
  } catch (error) {
    return siteApiError(error)
  }
}

async function POSTHandler(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await createSite(id, body) }, { status: 201 })
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

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
