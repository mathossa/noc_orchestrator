import { NextResponse } from 'next/server'
import { getImporterV2PublicationQa } from '@/lib/importer-v2-publication-store'
import { findImporterV2PublicationIdentityConflicts } from '@/lib/importer-v2-publication-identity-diagnostics'
import { findImporterV2PublicationNameConflicts } from '@/lib/importer-v2-publication-name-conflicts'
import {
  eligibleImporterV2PublicationRows,
  parseImporterV2PublicationSelection,
  withoutImporterV2ConflictingRows,
} from '@/lib/importer-v2-publication-selection'
import type { ImporterV2PublicationMode } from '@/lib/importer-v2-publication'
import { resolveImporterV2PublicationSelection } from '@/lib/importer-v2-workspace-store'

type Context = { params: Promise<{ batchId: string }> }

function publicationMode(value: unknown): ImporterV2PublicationMode {
  if (value === 'VALID_ONLY' || value === 'ALL_RESOLVED') return value
  throw new Error('Unsupported publication mode.')
}

export async function POST(request: Request, context: Context) {
  try {
    const { batchId } = await context.params
    const raw = (await request.json()) as {
      mode?: unknown
      selection?: unknown
    }
    const mode = publicationMode(raw.mode)
    const selection = parseImporterV2PublicationSelection(raw.selection)

    const [qa, matchingRows] = await Promise.all([
      getImporterV2PublicationQa(batchId),
      resolveImporterV2PublicationSelection({ batchId, selection }),
    ])

    const candidates =
      mode === 'VALID_ONLY'
        ? qa.publication.validOnlyCandidateRows
        : qa.publication.allResolvedCandidateRows
    const rowNumbers = eligibleImporterV2PublicationRows({
      candidates,
      matchingRows,
    })

    const [identityConflicts, nameConflicts] = await Promise.all([
      findImporterV2PublicationIdentityConflicts({
        batchId,
        rowNumbers,
      }),
      findImporterV2PublicationNameConflicts({
        batchId,
        rowNumbers,
      }),
    ])

    const candidateSet = new Set(rowNumbers)
    const conflictingRowNumbers = [
      ...new Set([
        ...identityConflicts.map((conflict) => conflict.rowNumber),
        ...nameConflicts,
      ]),
    ]
      .filter((rowNumber) => candidateSet.has(rowNumber))
      .sort((left, right) => left - right)
    const safeCandidateRows = withoutImporterV2ConflictingRows(
      rowNumbers,
      conflictingRowNumbers,
    )

    return NextResponse.json({
      data: {
        qaFingerprint: qa.qaFingerprint,
        mode,
        rowNumbers,
        matchedCount: matchingRows.length,
        eligibleCount: rowNumbers.length,
        skippedCount: matchingRows.length - rowNumbers.length,
        conflictingRowNumbers,
        safeCandidateRows,
        safeCandidateCount: safeCandidateRows.length,
        identityConflicts: identityConflicts.map((conflict) => ({
          rowNumber: conflict.rowNumber,
          sourceName: conflict.sourceName,
          hostname: conflict.hostname,
          sourceId: conflict.sourceIdentifiers.sourceId,
          selectedCanonicalDeviceId: conflict.selectedCanonicalDeviceId,
          canonicalConflicts: conflict.conflicts.map((match) => ({
            canonicalDeviceId: match.canonicalDeviceId,
            name: match.name,
            hostname: match.hostname,
            matchingIdentifiers: match.matchingIdentifiers,
          })),
          stagedConflicts: conflict.stagedConflicts.map((match) => ({
            rowNumber: match.rowNumber,
            sourceName: match.sourceName,
            hostname: match.hostname,
            sourceId: match.sourceId,
            selectedCanonicalDeviceId:
              match.selectedCanonicalDeviceId,
            matchingIdentifiers: match.matchingIdentifiers,
          })),
        })),
        nameConflictRowNumbers: nameConflicts,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Cannot resolve publication selection.'
    return NextResponse.json(
      { error: { message } },
      {
        status:
          error instanceof SyntaxError ||
          message.includes('selection') ||
          message.includes('Selection') ||
          message.includes('filter') ||
          message.includes('publication mode')
            ? 400
            : 500,
      },
    )
  }
}
