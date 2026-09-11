import { NextResponse } from 'next/server'
import {
  initializeImporterV2WorkspaceAutomation,
  recomputeImporterV2WorkspaceRows,
} from '@/lib/importer-v2-workspace-maintenance'
import { ensureImporterV2DerivedStackSourceIdentities } from '@/lib/importer-v2-stack-identity-store'
import { ensureImporterV2DerivedAuvikStandaloneIdentities } from '@/lib/importer-v2-auvik-derived-identity-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const automation = await initializeImporterV2WorkspaceAutomation(batchId)
    const derivedStackIdentity = await ensureImporterV2DerivedStackSourceIdentities(batchId)
    const derivedAuvikIdentity = await ensureImporterV2DerivedAuvikStandaloneIdentities(batchId)
    const derivedIdentityCount =
      derivedStackIdentity.appliedCount + derivedAuvikIdentity.appliedCount
    const finalState = derivedIdentityCount > 0
      ? await recomputeImporterV2WorkspaceRows({ batchId })
      : automation

    return NextResponse.json({
      data: {
        ...automation,
        ...finalState,
        automaticDecisionsApplied:
          (automation.automaticDecisionsApplied ?? 0) + derivedIdentityCount,
        derivedStackSourceIdsApplied: derivedStackIdentity.appliedCount,
        repairedStackIdentityCount: derivedStackIdentity.repairedIdentityCount,
        derivedAuvikDeviceSourceIdsApplied: derivedAuvikIdentity.appliedCount,
        bootstrappedAuvikDeviceMatches: derivedAuvikIdentity.bootstrappedExistingCount,
        repairedAuvikIdentityCount: derivedAuvikIdentity.repairedIdentityCount,
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
