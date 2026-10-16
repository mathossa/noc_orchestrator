import type { ImporterV2WorkspaceFilters, ImporterV2WorkspaceSelection } from '@/lib/importer-v2-workspace'
import type { ImporterV2PublicationMode } from '@/lib/importer-v2-publication'

const PUBLICATION_FILTERS = new Set([
  'search', 'status', 'issue', 'customer', 'businessUnit', 'site',
  'vendor', 'deviceType', 'sourceModel', 'canonicalModel',
  'firmwareEvidencePattern', 'repeatClassification',
])

/**
 * Shared validation for read-only selection previews and publication writes.
 * Importer query selections are always resolved again by the server; the
 * client cannot supply all-filtered row numbers as unverified input.
 */
export function parseImporterV2PublicationSelection(value: unknown): ImporterV2WorkspaceSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A staged publication selection is required.')
  }
  const selection = value as Record<string, unknown>
  if (selection.mode === 'ROWS') {
    if (!Array.isArray(selection.rowNumbers) || selection.rowNumbers.length > 20000 ||
      selection.rowNumbers.length === 0 ||
      selection.rowNumbers.some((row) => !Number.isSafeInteger(row) || row <= 0)) {
      throw new Error('Select 1–20,000 valid staged row numbers.')
    }
    return { mode: 'ROWS', rowNumbers: selection.rowNumbers as number[] }
  }
  if (selection.mode === 'QUERY') {
    if (!selection.filters || typeof selection.filters !== 'object' || Array.isArray(selection.filters)) {
      throw new Error('A filtered selection requires a filter object.')
    }
    for (const [field, entry] of Object.entries(selection.filters)) {
      if (!PUBLICATION_FILTERS.has(field) ||
        (entry !== null && (typeof entry !== 'string' || entry.length > 250))) {
        throw new Error('Invalid publication selection filter.')
      }
    }
    return { mode: 'QUERY', filters: selection.filters as ImporterV2WorkspaceFilters }
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

export function validImporterV2PublicationMode(value: unknown): value is ImporterV2PublicationMode {
  return value === 'VALID_ONLY' || value === 'ALL_RESOLVED'
}
