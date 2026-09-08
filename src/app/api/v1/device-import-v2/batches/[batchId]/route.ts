import { NextResponse } from 'next/server'
import { deleteImporterV2WorkspaceBatch } from '@/lib/importer-v2-workspace-maintenance'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const data = await deleteImporterV2WorkspaceBatch(batchId)
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete staged import.'
    const notFound = message.includes('not found')
    const conflict = message.includes('publication history')
    return NextResponse.json(
      {
        error: {
          code: notFound
            ? 'IMPORTER_BATCH_NOT_FOUND'
            : conflict
              ? 'IMPORTER_BATCH_HAS_PUBLICATION_HISTORY'
              : 'IMPORTER_BATCH_DELETE_FAILED',
          message,
        },
      },
      { status: notFound ? 404 : conflict ? 409 : 500 },
    )
  }
}
