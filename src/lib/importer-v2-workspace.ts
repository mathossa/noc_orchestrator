import { createHash } from 'node:crypto'
import { IMPORTER_V2_FIELDS, type ImporterV2Field } from '@/lib/importer-v2-evaluator'

export const IMPORTER_V2_WORKSPACE_PAGE_SIZE = 100
export const IMPORTER_V2_WORKSPACE_MAX_PAGE_SIZE = 200

export const IMPORTER_V2_WORKSPACE_GROUPS = [
  'status',
  'customer',
  'businessUnit',
  'site',
  'vendor',
  'deviceType',
  'sourceModel',
  'canonicalModel',
  'firmwareEvidencePattern',
  'repeatClassification',
] as const

export type ImporterV2WorkspaceGroup = (typeof IMPORTER_V2_WORKSPACE_GROUPS)[number]
export type ImporterV2WorkspaceRepeatClassification =
  | 'NEW'
  | 'CHANGED'
  | 'UNCHANGED'
  | 'MOVED'
  | 'RENAMED'
  | 'MISSING'
  | 'AMBIGUOUS'

export type ImporterV2WorkspaceFilters = {
  search?: string | null
  status?: string | null
  issue?: 'ANY' | 'ERROR' | 'WARNING' | 'NONE' | null
  customer?: string | null
  businessUnit?: string | null
  site?: string | null
  vendor?: string | null
  deviceType?: string | null
  sourceModel?: string | null
  canonicalModel?: string | null
  firmwareEvidencePattern?: string | null
  repeatClassification?: ImporterV2WorkspaceRepeatClassification | null
}

export type ImporterV2WorkspaceQuery = {
  page: number
  pageSize: number
  groupBy: ImporterV2WorkspaceGroup | null
  filters: ImporterV2WorkspaceFilters
}

export type ImporterV2WorkspaceSelection =
  | { mode: 'ROWS'; rowNumbers: readonly number[] }
  | { mode: 'QUERY'; filters: ImporterV2WorkspaceFilters }

export type ImporterV2WorkspaceAction =
  | {
      type: 'SET_FIELD' | 'LINK_FIELD'
      field: ImporterV2Field
      value: { id: string | null; label: string }
      explanation: string
    }
  | {
      type: 'CLEAR_FIELD' | 'IGNORE_FIELD'
      field: ImporterV2Field
      explanation: string
    }
  | {
      type: 'EXCLUDE_ROW'
      explanation: string
    }
  | {
      type: 'REMEMBER_EXACT'
      field: ImporterV2Field
      normalizedInput: string
      value: { id: string | null; label: string }
      explanation: string
    }
  | {
      type: 'CREATE_SCOPED_RULE'
      field: ImporterV2Field
      sourceValue: string
      value: { id: string | null; label: string } | null
      scope: Partial<
        Record<
          | 'customer'
          | 'businessUnit'
          | 'site'
          | 'vendor'
          | 'model'
          | 'productFamily'
          | 'deviceType',
          readonly string[]
        >
      >
      explanation: string
    }

export type ImporterV2WorkspaceSeedRow = {
  rowNumber: number
  sourceFingerprint: string
  inclusion: 'INCLUDED' | 'EXCLUDED'
  statuses: readonly string[]
  primaryStatus: string
  repeatClassification?: ImporterV2WorkspaceRepeatClassification | null
  issueCount: number
  hasErrors: boolean
  sourceName?: string | null
  hostname?: string | null
  customer?: string | null
  businessUnit?: string | null
  site?: string | null
  vendor?: string | null
  deviceType?: string | null
  sourceModel?: string | null
  canonicalModel?: string | null
  productFamily?: string | null
  softwarePlatform?: string | null
  firmwareEvidencePattern?: string | null
  rawFirmwareVersion?: string | null
  rawSoftwareVersion?: string | null
  interpretedFirmware?: string | null
  confidence?: string | null
  evaluated: unknown
  identityResolution?: unknown | null
  alternatives?: unknown | null
  repeatDiff?: unknown | null
}

export type ImporterV2WorkspacePreviewRow = {
  rowNumber: number
  sourceName: string | null
  customer: string | null
  businessUnit: string | null
  site: string | null
  sourceModel: string | null
  canonicalModel: string | null
  interpretedFirmware: string | null
  reviewRevision: number
}

export type ImporterV2WorkspaceActionPreview = {
  scopeToken: string
  affectedRowCount: number
  sample: readonly ImporterV2WorkspacePreviewRow[]
  action: ImporterV2WorkspaceAction
  requiresConfirmation: true
  commonValues: Partial<Record<ImporterV2Field, string | null | 'MIXED'>>
  confirmationReasons: readonly string[]
  contextVersion: string | null
}

function positiveInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

function clean(value: string | null) {
  const normalized = value?.normalize('NFKC').trim()
  return normalized || null
}

function isGroup(value: string | null): value is ImporterV2WorkspaceGroup {
  return IMPORTER_V2_WORKSPACE_GROUPS.includes(value as ImporterV2WorkspaceGroup)
}

export function parseImporterV2WorkspaceQuery(
  searchParams: URLSearchParams,
): ImporterV2WorkspaceQuery {
  const repeat = clean(searchParams.get('repeat'))
  const allowedRepeat = new Set<ImporterV2WorkspaceRepeatClassification>([
    'NEW',
    'CHANGED',
    'UNCHANGED',
    'MOVED',
    'RENAMED',
    'MISSING',
    'AMBIGUOUS',
  ])
  const issue = clean(searchParams.get('issue'))
  const filters: ImporterV2WorkspaceFilters = {
    search: clean(searchParams.get('q')),
    status: clean(searchParams.get('status')),
    issue:
      issue === 'ERROR' || issue === 'WARNING' || issue === 'NONE'
        ? issue
        : null,
    customer: clean(searchParams.get('customer')),
    businessUnit: clean(searchParams.get('businessUnit')),
    site: clean(searchParams.get('site')),
    vendor: clean(searchParams.get('vendor')),
    deviceType: clean(searchParams.get('deviceType')),
    sourceModel: clean(searchParams.get('sourceModel')),
    canonicalModel: clean(searchParams.get('canonicalModel')),
    firmwareEvidencePattern: clean(searchParams.get('firmwareEvidencePattern')),
    repeatClassification:
      repeat && allowedRepeat.has(repeat as ImporterV2WorkspaceRepeatClassification)
        ? (repeat as ImporterV2WorkspaceRepeatClassification)
        : null,
  }
  const group = clean(searchParams.get('groupBy'))
  return {
    page: positiveInteger(searchParams.get('page'), 1, 1_000_000),
    pageSize: positiveInteger(
      searchParams.get('pageSize'),
      IMPORTER_V2_WORKSPACE_PAGE_SIZE,
      IMPORTER_V2_WORKSPACE_MAX_PAGE_SIZE,
    ),
    groupBy: isGroup(group) ? group : null,
    filters,
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

export function importerV2WorkspaceScopeToken(input: {
  batchId: string
  selection: ImporterV2WorkspaceSelection
  action: ImporterV2WorkspaceAction
  rowVersions: readonly { rowNumber: number; reviewRevision: number }[]
  contextVersion?: string | null
}) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stableValue({
          batchId: input.batchId,
          selection: input.selection,
          action: input.action,
          contextVersion: input.contextVersion ?? null,
          rowVersions: [...input.rowVersions].sort(
            (a, b) => a.rowNumber - b.rowNumber,
          ),
        }),
      ),
    )
    .digest('hex')
}

export function importerV2WorkspaceActionNeedsReevaluation(
  action: ImporterV2WorkspaceAction,
) {
  return action.type !== 'EXCLUDE_ROW'
}

export function importerV2WorkspaceCommonValues(
  rows: readonly { evaluated: unknown }[],
): Partial<Record<ImporterV2Field, string | null | 'MIXED'>> {
  const result: Partial<Record<ImporterV2Field, string | null | 'MIXED'>> = {}
  for (const field of IMPORTER_V2_FIELDS) {
    const values = rows.map((row) => {
      const evaluated = row.evaluated as {
        proposedCanonicalValues?: Record<string, { label?: string } | null>
      }
      return evaluated.proposedCanonicalValues?.[field]?.label ?? null
    })
    const unique = new Set(values)
    result[field] = unique.size <= 1 ? (values[0] ?? null) : 'MIXED'
  }
  return result
}
