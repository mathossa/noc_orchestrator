import { NextResponse } from 'next/server'
import { getImporterV2PublicationQa } from '@/lib/importer-v2-publication-store'
import { findImporterV2PublicationIdentityConflicts } from '@/lib/importer-v2-publication-identity-diagnostics'
import { findImporterV2PublicationNameConflicts } from '@/lib/importer-v2-publication-name-conflicts'
import { resolveImporterV2PublicationSelection } from '@/lib/importer-v2-workspace-store'
import { eligibleImporterV2PublicationRows, parseImporterV2PublicationSelection, validImporterV2PublicationMode } from '@/lib/importer-v2-publication-selection'

type Context = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    const { batchId } = await context.params
    const raw = await request.json() as { mode?: unknown; selection?: unknown }
    if (!validImporterV2PublicationMode(raw?.mode)) throw new Error('Unsupported publication mode.')
    const selection = parseImporterV2PublicationSelection(raw?.selection)
    const [qa, matchingRows] = await Promise.all([
      getImporterV2PublicationQa(batchId),
      resolveImporterV2PublicationSelection({ batchId, selection }),
    ])
    const candidates = raw.mode === 'VALID_ONLY'
      ? qa.publication.validOnlyCandidateRows
      : qa.publication.allResolvedCandidateRows
    const rowNumbers = eligibleImporterV2PublicationRows({
      candidates, matchingRows,
    })
    const [identityConflicts, nameConflicts] = await Promise.all([
      findImporterV2PublicationIdentityConflicts({ batchId, rowNumbers }),
      findImporterV2PublicationNameConflicts({ batchId, rowNumbers }),
    ])
    const conflictingRowNumbers = [...new Set([
      ...identityConflicts.map((conflict) => conflict.rowNumber),
      ...nameConflicts,
    ])].sort((left, right) => left - right)
    const safeCandidateCount = rowNumbers.length - conflictingRowNumbers.length
    return NextResponse.json({ data: {
      qaFingerprint: qa.qaFingerprint,
      mode: raw.mode,
      rowNumbers,
      matchedCount: matchingRows.length,
      eligibleCount: rowNumbers.length,
      skippedCount: matchingRows.length - rowNumbers.length,
      conflictingRowNumbers,
      safeCandidateCount,
    } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot resolve publication selection.'
    return NextResponse.json({ error: { message } }, {
      status: error instanceof SyntaxError || message.includes('selection') ||
        message.includes('Selection') || message.includes('filter') ? 400 : 500,
    })
  }
}
