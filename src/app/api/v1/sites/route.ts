import { NextResponse } from 'next/server'
import { siteApiError } from '@/lib/site-api'
import { listSites } from '@/lib/site-store'

export async function GET() {
  try {
    return NextResponse.json({ data: await listSites() })
  } catch (error) {
    return siteApiError(error)
  }
}
