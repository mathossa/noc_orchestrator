import { NextResponse } from 'next/server'
import { recheckImporterV2Workspace } from '@/lib/importer-v2-workspace-maintenance'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    return NextResponse.json({ data: await recheckImporterV2Workspace(batchId) })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_RECHECK_FAILED',
          message: error instanceof Error ? error.message : 'Unable to recheck staged corrections.',
        },
      },
      { status: 500 },
    )
  }
}
