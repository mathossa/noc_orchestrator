import { NextResponse } from 'next/server'
import { getImporterV2PublicationQa } from '@/lib/importer-v2-publication-store'
import { resolveImporterV2PublicationSelection } from '@/lib/importer-v2-workspace-store'
import type { ImporterV2WorkspaceSelection } from '@/lib/importer-v2-workspace'
import type { ImporterV2PublicationMode } from '@/lib/importer-v2-publication'

type Context = { params: Promise<{ batchId: string }> }

function parseBody(body: unknown): {
  selection: ImporterV2WorkspaceSelection
  mode: ImporterV2PublicationMode
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A publication selection is required.')
  const value = body as Record<string, unknown>
  if (value.mode !== 'VALID_ONLY' && value.mode !== 'ALL_RESOLVED') throw new Error('Unsupported publication mode.')
  if (!value.selection || typeof value.selection !== 'object' || Array.isArray(value.selection)) {
    throw new Error('A staged selection is required.')
  }
  const selection = value.selection as Record<string, unknown>
  if (selection.mode === 'ROWS') {
    if (!Array.isArray(selection.rowNumbers) || selection.rowNumbers.length > 20000 ||
      selection.rowNumbers.length === 0 ||
      selection.rowNumbers.some((row) => !Number.isSafeInteger(row) || row <= 0)) {
      throw new Error('Select 1–20,000 valid staged row numbers.')
    }
  } else if (selection.mode === 'QUERY') {
    if (!selection.filters || typeof selection.filters !== 'object' || Array.isArray(selection.filters)) {
      throw new Error('A filtered selection requires a filter object.')
    }
    const permitted = new Set([
      'search', 'status', 'issue', 'customer', 'businessUnit', 'site',
      'vendor', 'deviceType', 'sourceModel', 'canonicalModel',
      'firmwareEvidencePattern', 'repeatClassification',
    ])
    for (const [field, entry] of Object.entries(selection.filters)) {
      if (!permitted.has(field) || (entry !== null && (typeof entry !== 'string' || entry.length > 250))) {
        throw new Error('Invalid publication selection filter.')
      }
    }
  } else throw new Error('Selection must use ROWS or QUERY.')
  return {
    mode: value.mode,
    selection: value.selection as ImporterV2WorkspaceSelection,
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { batchId } = await context.params
    const body = parseBody(await request.json())
    const [qa, matchingRows] = await Promise.all([
      getImporterV2PublicationQa(batchId),
      resolveImporterV2PublicationSelection({ batchId, selection: body.selection }),
    ])
    const eligible = new Set(body.mode === 'VALID_ONLY'
      ? qa.publication.validOnlyCandidateRows
      : qa.publication.allResolvedCandidateRows)
    const rowNumbers = matchingRows.filter((row) => eligible.has(row))
    return NextResponse.json({ data: {
      qaFingerprint: qa.qaFingerprint,
      rowNumbers,
      matchedCount: matchingRows.length,
      eligibleCount: rowNumbers.length,
      skippedCount: matchingRows.length - rowNumbers.length,
    } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot resolve publication selection.'
    return NextResponse.json({ error: { message } }, {
      status: error instanceof SyntaxError || message.includes('selection') ||
        message.includes('Selection') || message.includes('filter') ? 400 : 500,
    })
  }
}
