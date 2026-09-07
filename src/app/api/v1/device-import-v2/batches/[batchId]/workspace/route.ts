import { NextResponse } from 'next/server'
import { parseImporterV2WorkspaceQuery } from '@/lib/importer-v2-workspace'
import { queryImporterV2Workspace } from '@/lib/importer-v2-workspace-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const query = parseImporterV2WorkspaceQuery(new URL(request.url).searchParams)
    return NextResponse.json({ data: await queryImporterV2Workspace(batchId, query) })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_WORKSPACE_QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Unable to load the importer reconciliation workspace.',
        },
      },
      { status: 500 },
    )
  }
}
