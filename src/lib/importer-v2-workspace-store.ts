import type { Prisma } from '../../generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  importerV2WorkspaceActionNeedsReevaluation,
  importerV2WorkspaceCommonValues,
  importerV2WorkspaceScopeToken,
  type ImporterV2WorkspaceAction,
  type ImporterV2WorkspaceActionPreview,
  type ImporterV2WorkspaceFilters,
  type ImporterV2WorkspaceGroup,
  type ImporterV2WorkspaceQuery,
  type ImporterV2WorkspaceSeedRow,
  type ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'
import {
  getActiveImporterV2RuleSet,
  rememberImporterV2ExactMapping,
  replaceImporterV2RuleSet,
} from '@/lib/importer-v2-rule-store'
import type { ImporterV2RuleDefinition, ImporterV2RuleScope } from '@/lib/importer-v2-rule-types'

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function text(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim()
  return normalized || null
}

export function importerV2WorkspaceWhere(
  batchId: string,
  filters: ImporterV2WorkspaceFilters,
): Prisma.ImporterV2WorkspaceRowWhereInput {
  const where: Prisma.ImporterV2WorkspaceRowWhereInput = { batchId }
  if (filters.status) where.statuses = { has: filters.status }
  if (filters.customer) where.customer = filters.customer
  if (filters.businessUnit) where.businessUnit = filters.businessUnit
  if (filters.site) where.site = filters.site
  if (filters.vendor) where.vendor = filters.vendor
  if (filters.deviceType) where.deviceType = filters.deviceType
  if (filters.sourceModel) where.sourceModel = filters.sourceModel
  if (filters.canonicalModel) where.canonicalModel = filters.canonicalModel
  if (filters.firmwareEvidencePattern) where.firmwareEvidencePattern = filters.firmwareEvidencePattern
  if (filters.repeatClassification) where.repeatClassification = filters.repeatClassification
  if (filters.issue === 'ERROR') where.hasErrors = true
  if (filters.issue === 'WARNING') {
    where.hasErrors = false
    where.issueCount = { gt: 0 }
  }
  if (filters.issue === 'NONE') where.issueCount = 0
  const search = text(filters.search)
  if (search) {
    const contains = { contains: search, mode: 'insensitive' as const }
    where.OR = [
      { sourceName: contains },
      { hostname: contains },
      { customer: contains },
      { businessUnit: contains },
      { site: contains },
      { vendor: contains },
      { sourceModel: contains },
      { canonicalModel: contains },
      { rawFirmwareVersion: contains },
      { rawSoftwareVersion: contains },
      { interpretedFirmware: contains },
    ]
  }
  return where
}

export async function stageImporterV2Workspace(input: {
  name: string
  provider: string
  sourceAdapterId: string
  profileId: string
  profileVersion: string
  ruleBookId?: string | null
  evaluationFingerprint: string
  rows: readonly ImporterV2WorkspaceSeedRow[]
}) {
  const existing = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { evaluationFingerprint: input.evaluationFingerprint },
  })
  if (existing) return existing

  return prisma.$transaction(async (tx) => {
    const batch = await tx.importerV2WorkspaceBatch.create({
      data: {
        name: input.name,
        provider: input.provider,
        sourceAdapterId: input.sourceAdapterId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        ruleBookId: input.ruleBookId ?? null,
        evaluationFingerprint: input.evaluationFingerprint,
        rowCount: input.rows.length,
      },
    })
    if (input.rows.length > 0) {
      await tx.importerV2WorkspaceRow.createMany({
        data: input.rows.map((row) => ({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          sourceFingerprint: row.sourceFingerprint,
          inclusion: row.inclusion,
          statuses: [...row.statuses],
          primaryStatus: row.primaryStatus,
          repeatClassification: row.repeatClassification ?? null,
          issueCount: row.issueCount,
          hasErrors: row.hasErrors,
          sourceName: row.sourceName ?? null,
          hostname: row.hostname ?? null,
          customer: row.customer ?? null,
          businessUnit: row.businessUnit ?? null,
          site: row.site ?? null,
          vendor: row.vendor ?? null,
          deviceType: row.deviceType ?? null,
          sourceModel: row.sourceModel ?? null,
          canonicalModel: row.canonicalModel ?? null,
          productFamily: row.productFamily ?? null,
          softwarePlatform: row.softwarePlatform ?? null,
          firmwareEvidencePattern: row.firmwareEvidencePattern ?? null,
          rawFirmwareVersion: row.rawFirmwareVersion ?? null,
          rawSoftwareVersion: row.rawSoftwareVersion ?? null,
          interpretedFirmware: row.interpretedFirmware ?? null,
          confidence: row.confidence ?? null,
          evaluated: jsonValue(row.evaluated),
          identityResolution: row.identityResolution == null ? undefined : jsonValue(row.identityResolution),
          alternatives: row.alternatives == null ? undefined : jsonValue(row.alternatives),
          repeatDiff: row.repeatDiff == null ? undefined : jsonValue(row.repeatDiff),
        })),
      })
    }
    return batch
  })
}

export async function listImporterV2WorkspaceBatches() {
  return prisma.importerV2WorkspaceBatch.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      provider: true,
      profileVersion: true,
      status: true,
      rowCount: true,
      updatedAt: true,
    },
  })
}

async function groupRows(
  where: Prisma.ImporterV2WorkspaceRowWhereInput,
  groupBy: ImporterV2WorkspaceGroup,
) {
  const summarize = <T extends Record<string, unknown>>(items: readonly T[], key: keyof T) =>
    items.map((item) => ({
      value: (item[key] as string | null) ?? '(blank)',
      count: (item._count as { _all: number })._all,
      issueCount: (item._sum as { issueCount: number | null }).issueCount ?? 0,
    })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  const args = { where, _count: { _all: true }, _sum: { issueCount: true } } as const
  switch (groupBy) {
    case 'status': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['primaryStatus'] }), 'primaryStatus')
    case 'customer': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['customer'] }), 'customer')
    case 'businessUnit': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['businessUnit'] }), 'businessUnit')
    case 'site': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['site'] }), 'site')
    case 'vendor': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['vendor'] }), 'vendor')
    case 'deviceType': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['deviceType'] }), 'deviceType')
    case 'sourceModel': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['sourceModel'] }), 'sourceModel')
    case 'canonicalModel': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['canonicalModel'] }), 'canonicalModel')
    case 'firmwareEvidencePattern': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['firmwareEvidencePattern'] }), 'firmwareEvidencePattern')
    case 'repeatClassification': return summarize(await prisma.importerV2WorkspaceRow.groupBy({ ...args, by: ['repeatClassification'] }), 'repeatClassification')
  }
}

export async function queryImporterV2Workspace(batchId: string, query: ImporterV2WorkspaceQuery) {
  const batch = await prisma.importerV2WorkspaceBatch.findUniqueOrThrow({ where: { id: batchId } })
  const where = importerV2WorkspaceWhere(batchId, query.filters)
  const skip = (query.page - 1) * query.pageSize
  const [total, rows, groups, errorCount, warningCount] = await Promise.all([
    prisma.importerV2WorkspaceRow.count({ where }),
    prisma.importerV2WorkspaceRow.findMany({
      where,
      orderBy: { rowNumber: 'asc' },
      skip,
      take: query.pageSize,
      select: {
        rowNumber: true,
        inclusion: true,
        statuses: true,
        primaryStatus: true,
        repeatClassification: true,
        issueCount: true,
        hasErrors: true,
        needsReevaluation: true,
        sourceName: true,
        hostname: true,
        customer: true,
        businessUnit: true,
        site: true,
        vendor: true,
        deviceType: true,
        sourceModel: true,
        canonicalModel: true,
        productFamily: true,
        softwarePlatform: true,
        firmwareEvidencePattern: true,
        rawFirmwareVersion: true,
        rawSoftwareVersion: true,
        interpretedFirmware: true,
        confidence: true,
      },
    }),
    query.groupBy ? groupRows(where, query.groupBy) : Promise.resolve([]),
    prisma.importerV2WorkspaceRow.count({ where: { ...where, hasErrors: true } }),
    prisma.importerV2WorkspaceRow.count({ where: { ...where, hasErrors: false, issueCount: { gt: 0 } } }),
  ])
  return {
    batch: {
      id: batch.id,
      name: batch.name,
      provider: batch.provider,
      profileId: batch.profileId,
      profileVersion: batch.profileVersion,
      status: batch.status,
      rowCount: batch.rowCount,
    },
    page: query.page,
    pageSize: query.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    rows,
    groups,
    summary: { errorCount, warningCount },
  }
}

export async function getImporterV2WorkspaceRow(batchId: string, rowNumber: number) {
  return prisma.importerV2WorkspaceRow.findUniqueOrThrow({
    where: { batchId_rowNumber: { batchId, rowNumber } },
    include: { decisions: { orderBy: { createdAt: 'asc' } } },
  })
}

function selectionWhere(batchId: string, selection: ImporterV2WorkspaceSelection) {
  if (selection.mode === 'ROWS') {
    const rowNumbers = [...new Set(selection.rowNumbers)].filter((row) => Number.isInteger(row) && row > 0)
    if (rowNumbers.length === 0) throw new Error('Select at least one staged row.')
    return { batchId, rowNumber: { in: rowNumbers } } satisfies Prisma.ImporterV2WorkspaceRowWhereInput
  }
  return importerV2WorkspaceWhere(batchId, selection.filters)
}

async function rowsForAction(batchId: string, selection: ImporterV2WorkspaceSelection) {
  return prisma.importerV2WorkspaceRow.findMany({
    where: selectionWhere(batchId, selection),
    orderBy: { rowNumber: 'asc' },
    select: {
      id: true,
      rowNumber: true,
      reviewRevision: true,
      sourceName: true,
      customer: true,
      businessUnit: true,
      site: true,
      sourceModel: true,
      canonicalModel: true,
      interpretedFirmware: true,
      evaluated: true,
    },
  })
}

export async function previewImporterV2WorkspaceAction(input: {
  batchId: string
  selection: ImporterV2WorkspaceSelection
  action: ImporterV2WorkspaceAction
}): Promise<ImporterV2WorkspaceActionPreview> {
  const rows = await rowsForAction(input.batchId, input.selection)
  if (rows.length === 0) throw new Error('The selected workspace scope contains no rows.')
  const scopeToken = importerV2WorkspaceScopeToken({
    batchId: input.batchId,
    selection: input.selection,
    action: input.action,
    rowVersions: rows.map((row) => ({ rowNumber: row.rowNumber, reviewRevision: row.reviewRevision })),
  })
  return {
    scopeToken,
    affectedRowCount: rows.length,
    sample: rows.slice(0, 12),
    action: input.action,
    requiresConfirmation: true,
    commonValues: importerV2WorkspaceCommonValues(rows),
  }
}

function ruleScope(scope: Extract<ImporterV2WorkspaceAction, { type: 'CREATE_SCOPED_RULE' }>['scope'], field: string): ImporterV2RuleScope {
  return {
    customers: scope.customer,
    businessUnits: scope.businessUnit,
    sites: scope.site,
    vendors: scope.vendor,
    models: scope.model,
    productFamilies: scope.productFamily,
    deviceTypes: scope.deviceType,
    sourceFields: [field as never],
  }
}

async function persistReusableDecision(
  batchId: string,
  action: ImporterV2WorkspaceAction,
  scopeToken: string,
  actorUserId: string | null,
) {
  const batch = await prisma.importerV2WorkspaceBatch.findUniqueOrThrow({ where: { id: batchId } })
  if (action.type === 'REMEMBER_EXACT') {
    await rememberImporterV2ExactMapping({
      provider: batch.provider,
      profileId: batch.profileId,
      field: action.field,
      normalizedInput: action.normalizedInput,
      target: action.value,
      explanation: action.explanation,
      createdByUserId: actorUserId,
    })
  }
  if (action.type === 'CREATE_SCOPED_RULE') {
    if (!batch.ruleBookId) throw new Error('This staged batch has no rule book attached.')
    const active = await getActiveImporterV2RuleSet(batch.ruleBookId)
    if (!active) throw new Error('The attached rule book has no active revision.')
    const id = `workspace-${scopeToken.slice(0, 16)}`
    const candidate: ImporterV2RuleDefinition = {
      id,
      version: 1,
      name: `Workspace rule ${action.field}: ${action.sourceValue}`,
      description: action.explanation,
      priority: 100,
      status: 'ACTIVE',
      scope: ruleScope(action.scope, action.field),
      when: { kind: 'CONDITION', field: action.field, operator: 'NORMALIZED_EXACT', value: action.sourceValue },
      actions: action.value
        ? [{ type: 'MAP_VALUE', field: action.field, target: action.value }]
        : [{ type: 'CLEAR_FIELD', field: action.field }],
    }
    await replaceImporterV2RuleSet(batch.ruleBookId, {
      rules: [...active.rules.filter((rule) => rule.id !== id), candidate],
      createdByUserId: actorUserId,
      reason: action.explanation,
      activate: true,
    })
  }
}

export async function applyImporterV2WorkspaceAction(input: {
  batchId: string
  selection: ImporterV2WorkspaceSelection
  action: ImporterV2WorkspaceAction
  scopeToken: string
  actorUserId?: string | null
}) {
  const preview = await previewImporterV2WorkspaceAction(input)
  if (preview.scopeToken !== input.scopeToken) {
    throw new Error('The staged scope changed after preview. Preview the action again before applying it.')
  }
  const rows = await rowsForAction(input.batchId, input.selection)
  const actorUserId = input.actorUserId ?? null
  await persistReusableDecision(input.batchId, input.action, preview.scopeToken, actorUserId)

  const field = 'field' in input.action ? input.action.field : null
  const value = 'value' in input.action ? input.action.value : null
  await prisma.$transaction(async (tx) => {
    await tx.importerV2WorkspaceDecision.createMany({
      data: rows.map((row) => ({
        batchId: input.batchId,
        rowId: row.id,
        rowNumber: row.rowNumber,
        field,
        action: input.action.type,
        value: value == null ? undefined : jsonValue(value),
        explanation: input.action.explanation,
        scopeToken: preview.scopeToken,
        actorUserId,
      })),
    })
    await tx.importerV2WorkspaceRow.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: {
        reviewRevision: { increment: 1 },
        needsReevaluation: importerV2WorkspaceActionNeedsReevaluation(input.action),
      },
    })
  })
  return { affectedRowCount: rows.length, scopeToken: preview.scopeToken }
}
