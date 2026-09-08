import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import type { ImporterV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

export type WorkspaceRow = {
  rowNumber: number
  inclusion: string
  statuses: string[]
  primaryStatus: string
  repeatClassification: string | null
  issueCount: number
  hasErrors: boolean
  needsReevaluation: boolean
  sourceName: string | null
  hostname: string | null
  customer: string | null
  businessUnit: string | null
  site: string | null
  vendor: string | null
  deviceType: string | null
  sourceModel: string | null
  canonicalModel: string | null
  productFamily: string | null
  softwarePlatform: string | null
  firmwareEvidencePattern: string | null
  rawFirmwareVersion: string | null
  rawSoftwareVersion: string | null
  interpretedFirmware: string | null
  confidence: string | null
}

export type WorkspaceData = {
  batch: {
    id: string
    name: string
    provider: string
    profileId: string
    profileVersion: string
    status: string
    rowCount: number
  }
  page: number
  pageSize: number
  total: number
  pageCount: number
  rows: WorkspaceRow[]
  groups: { value: string; count: number; issueCount: number }[]
  summary: { errorCount: number; warningCount: number }
}

export type EvaluatedField = {
  proposedValue?: { id: string | null; label: string } | null
  decision?: {
    source?: string
    confidence?: string
    explanation?: string
    matchedRuleId?: string | null
    matchedRuleVersion?: string | null
    matchedParserId?: string | null
    matchedParserVersion?: string | null
  }
}

export type RowDetail = WorkspaceRow & {
  evaluated: {
    rawValues?: Record<string, string | null>
    proposedCanonicalValues?: Record<
      string,
      { id: string | null; label: string } | null
    >
    fields?: Record<string, EvaluatedField>
    issues?: Array<{
      field?: string
      severity?: string
      code?: string
      message?: string
    }>
    comparisonRecordId?: string | null
  }
  identityResolution?: unknown
  canonicalHierarchy?: ReturnType<typeof import('@/lib/importer-v2-canonical-hierarchy').resolveCanonicalHierarchy>
  identityReview?: ImporterV2WorkspaceIdentityReview | null
  alternatives?: unknown
  repeatDiff?: unknown
  resolvedIssues?: unknown[]
  activeErrorCount?: number
  activeWarningCount?: number
  decisions?: Array<{
    id: string
    field: string | null
    action: string
    value?: unknown
    explanation: string
    createdAt: string
  }>
}

export type ActionPreview = {
  scopeToken: string
  affectedRowCount: number
  sample: Array<{
    rowNumber: number
    sourceName: string | null
    customer: string | null
    businessUnit: string | null
    site: string | null
    sourceModel: string | null
    canonicalModel: string | null
    interpretedFirmware: string | null
  }>
  commonValues: Partial<Record<ImporterV2Field, string | null | 'MIXED'>>
  confirmationReasons: string[]
  contextVersion: string | null
}
