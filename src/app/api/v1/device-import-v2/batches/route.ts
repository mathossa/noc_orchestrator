import { NextResponse } from 'next/server'
import { listImporterV2WorkspaceBatches } from '@/lib/importer-v2-workspace-store'

export async function GET() {
  try {
    return NextResponse.json({ data: await listImporterV2WorkspaceBatches() })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'IMPORTER_WORKSPACE_ERROR', message: error instanceof Error ? error.message : 'Unable to load staged importer batches.' } },
      { status: 500 },
    )
  }
}
