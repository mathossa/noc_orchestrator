import { NextResponse } from 'next/server'
import { initializeImporterV2WorkspaceAutomation } from '@/lib/importer-v2-workspace-maintenance'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    return NextResponse.json({ data: await initializeImporterV2WorkspaceAutomation(batchId) })
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
