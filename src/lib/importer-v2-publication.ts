import { createHash } from 'node:crypto'
import type { ImporterV2Field, ImporterV2FieldIssue } from '@/lib/importer-v2-evaluator'
import { importerV2TopologyFromDecisions } from '@/lib/importer-v2-stack-topology'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

export type ImporterV2PublicationMode = 'ALL_RESOLVED' | 'VALID_ONLY'

export type ImporterV2PublicationDecision = {
  field: string | null
  action: string
  value?: unknown
  explanation?: string
  actorUserId?: string | null
  createdAt?: Date | string
}

export type ImporterV2PublicationQaRowInput = {
  id: string
  rowNumber: number
  sourceFingerprint: string
  inclusion: string
  statuses: string[]
  primaryStatus: string
  repeatClassification: string | null
  needsReevaluation: boolean
  reviewRevision: number
  publishedAt?: Date | null
  publicationAttemptId?: string | null
  firmwareEvidencePattern?: string | null
  evaluated: unknown
  identityResolution: unknown
  repeatDiff?: unknown
  decisions: readonly ImporterV2PublicationDecision[]
}

export type ImporterV2CatalogProposalField =
  | 'customer'
  | 'businessUnit'
  | 'site'
  | 'vendor'
  | 'productFamily'
  | 'deviceType'
  | 'model'
  | 'currentFirmware'

export type ImporterV2CatalogProposal = {
  key: string
  field: ImporterV2CatalogProposalField
  label: string
  context: Record<string, string | null>
  rowNumbers: number[]
}

export type ImporterV2StackQaGroup = {
  groupKey: string
  parentRowNumber: number
  parentName: string
  source: string | null
  memberRows: Array<{
    rowNumber: number
    memberIndex: number
    name: string
    serialNumber: string | null
    model: string | null
    firmware: string | null
  }>
}

export type ImporterV2PublicationQa = {
  qaFingerprint: string
  batch: {
    id: string
    name: string
    provider: string
    sourceAdapterId: string
    profileId: string
    profileVersion: string
    evaluationFingerprint: string
    status: string
    rowCount: number
    publishedRowCount: number
  }
  counts: {
    valid: number
    warning: number
    needsReview: number
    excluded: number
    create: number
    update: number
    unchanged: number
    conflict: number
    alreadyPublished: number
    pending: number
    stacks: number
    stackMembers: number
  }
  fieldErrors: Array<{
    rowNumber: number
    field: string
    severity: string
    code: string
    message: string
  }>
  catalogProposals: ImporterV2CatalogProposal[]
  identityConflicts: Array<{
    rowNumber: number
    kind: string | null
    explanation: string | null
    candidateDeviceIds: string[]
  }>
  topology: {
    stackGroups: ImporterV2StackQaGroup[]
  }
  evidence: {
    decisionSources: Array<{
      source: string
      count: number
      sampleRows: number[]
    }>
    workspaceDecisions: Array<{
      action: string
      count: number
      sampleRows: number[]
    }>
    matchedEvidence: Array<{
      source: string
      evidenceId: string
      version: string | null
      count: number
      sampleRows: number[]
    }>
  }
  repeatImport: Record<string, number>
  firmware: {
    deterministicParserRows: number[]
    rememberedExactRows: number[]
    manuallyResolvedRows: number[]
    rawFirmwareSoftwareDifferences: number[]
    rawVsEffective: Array<{
      rowNumber: number
      rawFirmwareVersion: string | null
      rawSoftwareVersion: string | null
      effectiveRunningVersion: string | null
    }>
    unknownFirmwareRows: number[]
    platformConflictRows: number[]
    newObservedReleaseProposalRows: number[]
    evidencePatterns: Array<{
      pattern: string
      count: number
      sampleRows: number[]
    }>
  }
  publication: {
    allResolvedCandidateRows: number[]
    validOnlyCandidateRows: number[]
    unresolvedRows: Array<{ rowNumber: number; reasons: string[] }>
    excludedRows: number[]
  }
}

type CanonicalTarget = { id?: string | null; label?: string } | null

type EvaluatedSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
  fields?: Partial<
    Record<
      ImporterV2Field,
      {
        decision?: {
          source?: string
          matchedRuleId?: string | null
          matchedRuleVersion?: string | null
          matchedParserId?: string | null
          matchedParserVersion?: string | null
        }
      }
    >
  >
  issues?: ImporterV2FieldIssue[]
  firmware?: {
    warnings?: Array<{ code?: string; message?: string }>
  }
}

const CATALOG_PROPOSAL_FIELDS = new Set<ImporterV2CatalogProposalField>([
  'customer',
  'businessUnit',
  'site',
  'vendor',
  'productFamily',
  'deviceType',
  'model',
  'currentFirmware',
])

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

function hash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function normalized(value: string | null | undefined) {
  const text = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return text || null
}

function targetKey(value: CanonicalTarget) {
  if (!value) return null
  return value.id || normalized(value.label) || null
}

function targetLabel(value: CanonicalTarget) {
  return normalized(value?.label)
}

function effectiveText(snapshot: EvaluatedSnapshot, field: ImporterV2Field) {
  return (
    targetLabel(snapshot.proposedCanonicalValues?.[field] ?? null) ??
    normalized(snapshot.rawValues?.[field])
  )
}

function proposalContext(
  field: ImporterV2CatalogProposalField,
  values: Partial<Record<ImporterV2Field, CanonicalTarget>>,
): Record<string, string | null> {
  const contextValue = (name: ImporterV2Field) => targetKey(values[name] ?? null)
  switch (field) {
    case 'businessUnit':
      return { customer: contextValue('customer') }
    case 'site':
      return {
        customer: contextValue('customer'),
        businessUnit: contextValue('businessUnit'),
      }
    case 'productFamily':
      return { vendor: contextValue('vendor') }
    case 'model':
      return {
        vendor: contextValue('vendor'),
        deviceType: contextValue('deviceType'),
        productFamily: contextValue('productFamily'),
      }
    case 'currentFirmware':
      return {
        vendor: contextValue('vendor'),
        softwarePlatform: contextValue('softwarePlatform'),
      }
    default:
      return {}
  }
}

export function importerV2CatalogProposalKey(input: {
  field: ImporterV2CatalogProposalField
  label: string
  context: Record<string, string | null>
}) {
  return hash({
    field: input.field,
    label: normalized(input.label)?.toLocaleLowerCase('en-US') ?? '',
    context: input.context,
  })
}

function activeClassification(row: ImporterV2PublicationQaRowInput) {
  const statuses = new Set(row.statuses)
  if (row.repeatClassification) statuses.add(row.repeatClassification)
  return statuses
}

function rowBlockers(input: {
  row: ImporterV2PublicationQaRowInput
  activeErrorCount: number
  sourceId: string | null
}) {
  const { row, activeErrorCount } = input
  if (row.inclusion === 'EXCLUDED') return []
  const topology = importerV2TopologyFromDecisions(row.decisions)
  const reasons: string[] = []
  if (row.needsReevaluation) reasons.push('Re-evaluation is required after a staged correction.')
  if (activeErrorCount > 0) reasons.push(`${activeErrorCount} unresolved validation error(s) remain.`)

  if (topology.role === 'STACK_MEMBER') return reasons

  if (topology.role === 'STACK' && !input.sourceId) {
    reasons.push('Logical stack requires a provider Source ID; member serial/MAC values cannot identify the stack itself.')
  }

  const identity = importerV2WorkspaceIdentityReview({
    identityResolution: row.identityResolution,
    decisions: row.decisions,
  })
  if (!identity) reasons.push('Durable device identity evidence is missing.')
  else if (identity.requiresConfirmation) reasons.push('Device identity still requires confirmation.')
  else if (identity.kind === 'INVALID') reasons.push('Device identity is invalid.')
  if (row.repeatClassification === 'AMBIGUOUS') reasons.push('Repeat-import identity is ambiguous.')
  return reasons
}

function addSample(map: Map<string, { count: number; sampleRows: number[] }>, key: string, rowNumber: number) {
  const item = map.get(key) ?? { count: 0, sampleRows: [] }
  item.count += 1
  if (item.sampleRows.length < 5 && !item.sampleRows.includes(rowNumber)) item.sampleRows.push(rowNumber)
  map.set(key, item)
}

export function buildImporterV2PublicationQa(input: {
  batch: {
    id: string
    name: string
    provider: string
    sourceAdapterId: string
    profileId: string
    profileVersion: string
    evaluationFingerprint: string
    status: string
    rowCount: number
    publishedRowCount?: number
  }
  rows: readonly ImporterV2PublicationQaRowInput[]
}): ImporterV2PublicationQa {
  const counts = {
    valid: 0,
    warning: 0,
    needsReview: 0,
    excluded: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
    alreadyPublished: 0,
    pending: 0,
    stacks: 0,
    stackMembers: 0,
  }
  const fieldErrors: ImporterV2PublicationQa['fieldErrors'] = []
  const identityConflicts: ImporterV2PublicationQa['identityConflicts'] = []
  const repeatImport: Record<string, number> = {}
  const proposals = new Map<string, ImporterV2CatalogProposal>()
  const decisionSources = new Map<string, { count: number; sampleRows: number[] }>()
  const workspaceDecisions = new Map<string, { count: number; sampleRows: number[] }>()
  const matchedEvidence = new Map<string, { source: string; evidenceId: string; version: string | null; count: number; sampleRows: number[] }>()
  const evidencePatterns = new Map<string, { count: number; sampleRows: number[] }>()
  const deterministicParserRows = new Set<number>()
  const rememberedExactRows = new Set<number>()
  const manuallyResolvedRows = new Set<number>()
  const rawFirmwareSoftwareDifferences = new Set<number>()
  const rawVsEffective: ImporterV2PublicationQa['firmware']['rawVsEffective'] = []
  const unknownFirmwareRows = new Set<number>()
  const platformConflictRows = new Set<number>()
  const newObservedReleaseProposalRows = new Set<number>()
  const allResolvedCandidateRows: number[] = []
  const validOnlyCandidateRows: number[] = []
  const unresolvedRows: Array<{ rowNumber: number; reasons: string[] }> = []
  const excludedRows: number[] = []
  const rowTopology = new Map<number, {
    topology: ReturnType<typeof importerV2TopologyFromDecisions>
    name: string
    serialNumber: string | null
    model: string | null
    firmware: string | null
  }>()

  for (const row of [...input.rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
    if (row.publishedAt) counts.alreadyPublished += 1
    else counts.pending += 1

    if (row.inclusion === 'EXCLUDED') {
      counts.excluded += 1
      excludedRows.push(row.rowNumber)
      continue
    }

    const effective = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: row.inclusion,
      decisions: row.decisions,
    })
    const snapshot = effective.evaluated as EvaluatedSnapshot
    const topology = importerV2TopologyFromDecisions(row.decisions)
    const isStackMember = topology.role === 'STACK_MEMBER'
    if (topology.role === 'STACK') counts.stacks += 1
    if (isStackMember) counts.stackMembers += 1

    rowTopology.set(row.rowNumber, {
      topology,
      name: effectiveText(snapshot, 'deviceName') ?? effectiveText(snapshot, 'hostname') ?? `Row #${row.rowNumber}`,
      serialNumber: effectiveText(snapshot, 'serialNumber'),
      model: effectiveText(snapshot, 'model'),
      firmware: effectiveText(snapshot, 'currentFirmware'),
    })

    if (!isStackMember) {
      if (row.primaryStatus === 'VALID') counts.valid += 1
      else if (row.primaryStatus === 'WARNING') counts.warning += 1
      else counts.needsReview += 1

      const classifications = activeClassification(row)
      if (classifications.has('NEW')) counts.create += 1
      if (
        classifications.has('UPDATE') ||
        classifications.has('CHANGED') ||
        classifications.has('MOVED') ||
        classifications.has('RENAMED')
      ) counts.update += 1
      if (classifications.has('UNCHANGED')) counts.unchanged += 1
      if (row.repeatClassification) {
        repeatImport[row.repeatClassification] = (repeatImport[row.repeatClassification] ?? 0) + 1
      }
    }

    const issues = snapshot.issues ?? []
    for (const issue of issues) {
      fieldErrors.push({
        rowNumber: row.rowNumber,
        field: issue.field,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
      })
    }

    if (!isStackMember) {
      const identity = importerV2WorkspaceIdentityReview({
        identityResolution: row.identityResolution,
        decisions: row.decisions,
      })
      if (identity?.requiresConfirmation || identity?.kind === 'AMBIGUOUS' || identity?.kind === 'INVALID') {
        identityConflicts.push({
          rowNumber: row.rowNumber,
          kind: identity.kind,
          explanation: identity.explanation,
          candidateDeviceIds: identity.candidates.map((candidate) => candidate.canonicalDeviceId),
        })
      }
    }

    const blockers = rowBlockers({
      row,
      activeErrorCount: effective.activeErrorCount,
      sourceId: effectiveText(snapshot, 'sourceId'),
    })
    if (blockers.length > 0) {
      counts.conflict += 1
      if (!row.publishedAt) unresolvedRows.push({ rowNumber: row.rowNumber, reasons: blockers })
    } else if (!row.publishedAt && !isStackMember) {
      allResolvedCandidateRows.push(row.rowNumber)
      if (row.primaryStatus === 'VALID') validOnlyCandidateRows.push(row.rowNumber)
    }

    const values = snapshot.proposedCanonicalValues ?? {}
    for (const [rawField, target] of Object.entries(values)) {
      const field = rawField as ImporterV2CatalogProposalField
      if (!CATALOG_PROPOSAL_FIELDS.has(field) || target?.id) continue
      const label = targetLabel(target)
      if (!label) continue
      const context = proposalContext(field, values)
      const key = importerV2CatalogProposalKey({ field, label, context })
      const existing = proposals.get(key)
      if (existing) {
        if (!existing.rowNumbers.includes(row.rowNumber)) existing.rowNumbers.push(row.rowNumber)
      } else {
        proposals.set(key, { key, field, label, context, rowNumbers: [row.rowNumber] })
      }
      if (field === 'currentFirmware') newObservedReleaseProposalRows.add(row.rowNumber)
    }

    for (const field of Object.values(snapshot.fields ?? {})) {
      const source = field?.decision?.source
      if (!source) continue
      addSample(decisionSources, source, row.rowNumber)
      if (source === 'DETERMINISTIC_PARSER') deterministicParserRows.add(row.rowNumber)
      if (source === 'REMEMBERED_EXACT_MAPPING') rememberedExactRows.add(row.rowNumber)
      const evidenceId = field?.decision?.matchedRuleId ?? field?.decision?.matchedParserId ?? null
      const version = field?.decision?.matchedRuleId
        ? field?.decision?.matchedRuleVersion ?? null
        : field?.decision?.matchedParserVersion ?? null
      if (evidenceId) {
        const evidenceKey = `${source}:${evidenceId}:${version ?? ''}`
        const evidence = matchedEvidence.get(evidenceKey) ?? { source, evidenceId, version, count: 0, sampleRows: [] }
        evidence.count += 1
        if (evidence.sampleRows.length < 5 && !evidence.sampleRows.includes(row.rowNumber)) evidence.sampleRows.push(row.rowNumber)
        matchedEvidence.set(evidenceKey, evidence)
      }
    }
    for (const decision of row.decisions) {
      addSample(workspaceDecisions, decision.action, row.rowNumber)
      manuallyResolvedRows.add(row.rowNumber)
    }

    const rawFirmware = normalized(snapshot.rawValues?.firmwareVersion)
    const rawSoftware = normalized(snapshot.rawValues?.softwareVersion)
    if (rawFirmware && rawSoftware && rawFirmware !== rawSoftware) {
      rawFirmwareSoftwareDifferences.add(row.rowNumber)
    }
    const effectiveFirmware = targetLabel(values.currentFirmware ?? null)
    if (!effectiveFirmware) unknownFirmwareRows.add(row.rowNumber)
    if (effectiveFirmware && (effectiveFirmware !== rawFirmware || effectiveFirmware !== rawSoftware)) {
      rawVsEffective.push({
        rowNumber: row.rowNumber,
        rawFirmwareVersion: rawFirmware,
        rawSoftwareVersion: rawSoftware,
        effectiveRunningVersion: effectiveFirmware,
      })
    }
    if (
      snapshot.firmware?.warnings?.some((warning) =>
        ['PLATFORM_EVIDENCE_CONFLICT', 'PLATFORM_INCOMPATIBLE'].includes(warning.code ?? ''),
      )
    ) platformConflictRows.add(row.rowNumber)

    addSample(evidencePatterns, row.firmwareEvidencePattern || '(unclassified)', row.rowNumber)
  }

  const stackGroups: ImporterV2StackQaGroup[] = []
  const unresolvedNumbers = new Set(unresolvedRows.map((row) => row.rowNumber))
  for (const [rowNumber, parent] of rowTopology) {
    if (parent.topology.role !== 'STACK') continue
    const members = parent.topology.memberRows.flatMap((reference) => {
      const member = rowTopology.get(reference.rowNumber)
      if (!member || member.topology.role !== 'STACK_MEMBER') return []
      return [{
        rowNumber: reference.rowNumber,
        memberIndex: reference.memberIndex,
        name: member.name,
        serialNumber: member.serialNumber,
        model: member.model,
        firmware: member.firmware,
      }]
    })
    stackGroups.push({
      groupKey: parent.topology.groupKey ?? `stack-row-${rowNumber}`,
      parentRowNumber: rowNumber,
      parentName: parent.name,
      source: parent.topology.source,
      memberRows: members,
    })

    const unresolvedMembers = members
      .filter((member) => unresolvedNumbers.has(member.rowNumber))
      .map((member) => member.rowNumber)
    if (unresolvedMembers.length > 0 && !unresolvedNumbers.has(rowNumber)) {
      unresolvedRows.push({
        rowNumber,
        reasons: [`Stack member row(s) #${unresolvedMembers.join(', #')} still require review before this logical stack can publish.`],
      })
      unresolvedNumbers.add(rowNumber)
      counts.conflict += 1
    }
    if (unresolvedMembers.length > 0) {
      const allIndex = allResolvedCandidateRows.indexOf(rowNumber)
      if (allIndex >= 0) allResolvedCandidateRows.splice(allIndex, 1)
      const validIndex = validOnlyCandidateRows.indexOf(rowNumber)
      if (validIndex >= 0) validOnlyCandidateRows.splice(validIndex, 1)
    }
  }

  const qaFingerprint = hash({
    batchId: input.batch.id,
    evaluationFingerprint: input.batch.evaluationFingerprint,
    status: input.batch.status,
    rows: [...input.rows]
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((row) => {
        const topology = importerV2TopologyFromDecisions(row.decisions)
        return {
          rowNumber: row.rowNumber,
          inclusion: row.inclusion,
          reviewRevision: row.reviewRevision,
          topologyRole: topology.role,
          topologyGroupKey: topology.groupKey,
          topologyParentRowNumber: topology.parentRowNumber,
          topologyMemberIndex: topology.memberIndex,
          publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : row.publishedAt ?? null,
          publicationAttemptId: row.publicationAttemptId ?? null,
        }
      }),
  })

  return {
    qaFingerprint,
    batch: {
      ...input.batch,
      publishedRowCount: input.batch.publishedRowCount ?? counts.alreadyPublished,
    },
    counts,
    fieldErrors,
    catalogProposals: [...proposals.values()].sort((a, b) => a.field.localeCompare(b.field) || a.label.localeCompare(b.label)),
    identityConflicts,
    topology: {
      stackGroups: stackGroups.sort((a, b) => a.parentRowNumber - b.parentRowNumber),
    },
    evidence: {
      decisionSources: [...decisionSources.entries()].map(([source, value]) => ({ source, ...value })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
      workspaceDecisions: [...workspaceDecisions.entries()].map(([action, value]) => ({ action, ...value })).sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)),
      matchedEvidence: [...matchedEvidence.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source) || a.evidenceId.localeCompare(b.evidenceId)),
    },
    repeatImport,
    firmware: {
      deterministicParserRows: [...deterministicParserRows].sort((a, b) => a - b),
      rememberedExactRows: [...rememberedExactRows].sort((a, b) => a - b),
      manuallyResolvedRows: [...manuallyResolvedRows].sort((a, b) => a - b),
      rawFirmwareSoftwareDifferences: [...rawFirmwareSoftwareDifferences].sort((a, b) => a - b),
      rawVsEffective,
      unknownFirmwareRows: [...unknownFirmwareRows].sort((a, b) => a - b),
      platformConflictRows: [...platformConflictRows].sort((a, b) => a - b),
      newObservedReleaseProposalRows: [...newObservedReleaseProposalRows].sort((a, b) => a - b),
      evidencePatterns: [...evidencePatterns.entries()].map(([pattern, value]) => ({ pattern, ...value })).sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)),
    },
    publication: {
      allResolvedCandidateRows,
      validOnlyCandidateRows,
      unresolvedRows: unresolvedRows.sort((a, b) => a.rowNumber - b.rowNumber),
      excludedRows,
    },
  }
}

export function importerV2OwnedDeviceScalarPatch(input: {
  allowedFields: ReadonlySet<string>
  values: Partial<Record<ImporterV2Field, string | null>>
}) {
  const patch: {
    name?: string
    hostname?: string | null
    serialNumber?: string | null
    managementAddress?: string | null
    notes?: string | null
  } = {}
  if (input.allowedFields.has('deviceName') && input.values.deviceName) {
    patch.name = input.values.deviceName
  }
  if (input.allowedFields.has('hostname')) patch.hostname = input.values.hostname ?? null
  if (input.allowedFields.has('serialNumber')) patch.serialNumber = input.values.serialNumber ?? null
  if (input.allowedFields.has('managementAddress')) {
    patch.managementAddress = input.values.managementAddress ?? null
  }
  if (input.allowedFields.has('notes')) patch.notes = input.values.notes ?? null
  return patch
}

export function importerV2PublicationRowsIncludingStackMembers(
  qa: ImporterV2PublicationQa,
  rowNumbers: readonly number[],
) {
  const rows = new Set(rowNumbers)
  for (const group of qa.topology.stackGroups) {
    if (!rows.has(group.parentRowNumber)) continue
    for (const member of group.memberRows) rows.add(member.rowNumber)
  }
  return rows
}

export function selectImporterV2PublicationRows(
  qa: ImporterV2PublicationQa,
  mode: ImporterV2PublicationMode,
) {
  if (mode === 'ALL_RESOLVED' && qa.publication.unresolvedRows.length > 0) {
    throw new Error('Resolve every included row before publishing the entire batch.')
  }
  const rowNumbers = mode === 'VALID_ONLY'
    ? qa.publication.validOnlyCandidateRows
    : qa.publication.allResolvedCandidateRows
  if (rowNumbers.length === 0) {
    throw new Error('No unpublished rows are eligible for this publication mode.')
  }
  return rowNumbers
}
