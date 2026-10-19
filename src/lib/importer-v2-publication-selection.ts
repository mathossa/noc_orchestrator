import type {
  ImporterV2WorkspaceFilters,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'

const PUBLICATION_FILTERS = new Set([
  'search',
  'status',
  'issue',
  'customer',
  'businessUnit',
  'site',
  'vendor',
  'deviceType',
  'sourceModel',
  'canonicalModel',
  'firmwareEvidencePattern',
  'repeatClassification',
  'publication',
])

/**
 * Validate a staged publication selection. QUERY selections are always
 * resolved server-side against the workspace; clients never provide the
 * expanded row list for "select all matching".
 */
export function parseImporterV2PublicationSelection(
  value: unknown,
): ImporterV2WorkspaceSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A staged publication selection is required.')
  }

  const selection = value as Record<string, unknown>
  if (selection.mode === 'ROWS') {
    if (
      !Array.isArray(selection.rowNumbers) ||
      selection.rowNumbers.length === 0 ||
      selection.rowNumbers.length > 20_000 ||
      selection.rowNumbers.some(
        (row) => !Number.isSafeInteger(row) || Number(row) <= 0,
      )
    ) {
      throw new Error('Select 1–20,000 valid staged row numbers.')
    }

    return {
      mode: 'ROWS',
      rowNumbers: [...new Set(selection.rowNumbers as number[])].sort(
        (left, right) => left - right,
      ),
    }
  }

  if (selection.mode === 'QUERY') {
    if (
      !selection.filters ||
      typeof selection.filters !== 'object' ||
      Array.isArray(selection.filters)
    ) {
      throw new Error('A filtered selection requires a filter object.')
    }

    for (const [field, entry] of Object.entries(
      selection.filters as Record<string, unknown>,
    )) {
      if (
        !PUBLICATION_FILTERS.has(field) ||
        !(
          entry === null ||
          entry === undefined ||
          typeof entry === 'string'
        )
      ) {
        throw new Error('Invalid publication selection filter.')
      }
      if (
        field === 'publication' &&
        entry !== null &&
        entry !== undefined &&
        entry !== 'PENDING' &&
        entry !== 'PUBLISHED' &&
        entry !== 'EXCLUDED' &&
        entry !== 'ALL'
      ) {
        throw new Error('Invalid publication-state filter.')
      }
    }

    return {
      mode: 'QUERY',
      filters: selection.filters as ImporterV2WorkspaceFilters,
    }
  }

  throw new Error('Selection must use ROWS or QUERY.')
}

export function eligibleImporterV2PublicationRows(input: {
  candidates: readonly number[]
  matchingRows: readonly number[]
}) {
  const selected = new Set(input.matchingRows)
  return input.candidates.filter((rowNumber) => selected.has(rowNumber))
}

/**
 * Leave conflicting source rows staged while publishing the rest of an
 * explicitly selected scope. All sides of a collision are deferred; no row is
 * chosen as an arbitrary winner.
 */
export function withoutImporterV2ConflictingRows(
  candidates: readonly number[],
  conflictedRowNumbers: readonly number[],
) {
  const blocked = new Set(conflictedRowNumbers)
  return candidates.filter((rowNumber) => !blocked.has(rowNumber))
}
