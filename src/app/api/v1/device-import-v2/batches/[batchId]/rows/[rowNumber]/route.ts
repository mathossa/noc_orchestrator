import { NextResponse } from 'next/server'
import { getImporterV2WorkspaceRow } from '@/lib/importer-v2-workspace-store'

type RouteContext = { params: Promise<{ batchId: string; rowNumber: string }> }

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { batchId, rowNumber: rowNumberText } = await context.params
    const rowNumber = Number.parseInt(rowNumberText, 10)
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROW_NUMBER', message: 'rowNumber must be a positive integer.' } },
        { status: 400 },
      )
    }
    return NextResponse.json({ data: await getImporterV2WorkspaceRow(batchId, rowNumber) })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_WORKSPACE_ROW_FAILED',
          message: error instanceof Error ? error.message : 'Unable to load the staged row.',
        },
      },
      { status: 500 },
    )
  }
}
