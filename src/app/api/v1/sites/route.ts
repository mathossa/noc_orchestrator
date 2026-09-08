import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { listSites } from '@/lib/site-store'

export async function GET(request: Request) {
  try {
    return NextResponse.json({ data: await listSites(new URL(request.url).searchParams.get('organizationUnit') ?? undefined) })
  } catch (error) {
    return siteApiError(error)
  }
}
