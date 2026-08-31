import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { createSite, listSiteContractTypes, listSitesForCustomer } from '@/lib/site-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const [sites, contractTypes] = await Promise.all([
      listSitesForCustomer(id),
      listSiteContractTypes(),
    ])
    return NextResponse.json({ data: sites, contractTypes })
  } catch (error) {
    return siteApiError(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
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
