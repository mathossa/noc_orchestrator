import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { diagnoseClassicCentralSwitchSites } from '@/lib/aruba-classic-switch-site-diagnostics'

type Context = { params: Promise<{ sourceId: string }> }

/** Does NOT stage, import, publish, change site mapping or create jobs. */
export async function POST(request: Request, context: Context) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    return NextResponse.json({
      data: await diagnoseClassicCentralSwitchSites(sourceId),
    })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({
        error: { code: 'ACCESS_DENIED', message: error.message },
      }, { status: error.status })
    }
    const message = error instanceof Error ? error.message :
      'Unable to diagnose Classic switch sites.'
    return NextResponse.json({
      error: { code: 'ARUBA_SWITCH_SITE_DIAGNOSTICS_FAILED', message },
    }, { status: message.includes('not found') ? 404 : 400 })
  }
}
