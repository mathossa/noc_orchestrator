import { NextResponse } from 'next/server'
import {
  initializeImporterV2WorkspaceAutomation,
  recomputeImporterV2WorkspaceRows,
} from '@/lib/importer-v2-workspace-maintenance'
import { ensureImporterV2DerivedStackSourceIdentities } from '@/lib/importer-v2-stack-identity-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const automation = await initializeImporterV2WorkspaceAutomation(batchId)
    const derivedStackIdentity = await ensureImporterV2DerivedStackSourceIdentities(batchId)
    const finalState = derivedStackIdentity.appliedCount > 0
      ? await recomputeImporterV2WorkspaceRows({ batchId })
      : automation

    return NextResponse.json({
      data: {
        ...automation,
        ...finalState,
        derivedStackSourceIdsApplied: derivedStackIdentity.appliedCount,
        repairedStackIdentityCount: derivedStackIdentity.repairedIdentityCount,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_AUTOMATION_FAILED',
          message: error instanceof Error ? error.message : 'Unable to run importer automation.',
        },
      },
      { status: 500 },
    )
  }
}
