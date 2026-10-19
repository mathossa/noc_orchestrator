import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { listSites } from '@/lib/site-store'

async function GETHandler(request: Request) {
  try {
    return NextResponse.json({ data: await listSites(new URL(request.url).searchParams.get('organizationUnit') ?? undefined) })
  } catch (error) {
    return siteApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
