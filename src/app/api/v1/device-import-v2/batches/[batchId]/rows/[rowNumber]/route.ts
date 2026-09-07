import { NextResponse } from 'next/server'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
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

    const row = await getImporterV2WorkspaceRow(batchId, rowNumber)
    const effective = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: row.inclusion,
      decisions: row.decisions,
    })

    return NextResponse.json({
      data: {
        ...row,
        evaluated: effective.evaluated,
        resolvedIssues: effective.resolvedIssues,
        activeErrorCount: effective.activeErrorCount,
        activeWarningCount: effective.activeWarningCount,
      },
    })
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
