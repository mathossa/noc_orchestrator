import { NextResponse } from 'next/server'
import { reconcileImporterV2ManualIdentity } from '@/lib/importer-v2-workspace-identity-repair'
import { recheckImporterV2Workspace } from '@/lib/importer-v2-workspace-maintenance'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const identityRepair = await reconcileImporterV2ManualIdentity(batchId)
    const recheck = await recheckImporterV2Workspace(batchId)
    return NextResponse.json({ data: { ...recheck, identityRepair } })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_RECHECK_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to recheck staged corrections.',
        },
      },
      { status: 500 },
    )
  }
}
