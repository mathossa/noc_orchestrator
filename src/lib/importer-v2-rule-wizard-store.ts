import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { ImporterV2Field, ImporterV2StagedRow } from '@/lib/importer-v2-evaluator'
import { previewImporterV2RuleChange } from '@/lib/importer-v2-rule-preview'
import {
  getActiveImporterV2RuleSet,
  replaceImporterV2RuleSet,
} from '@/lib/importer-v2-rule-store'
import type {
  ImporterV2RuleConditionOperator,
  ImporterV2RuleDefinition,
  ImporterV2RuleScope,
  ImporterV2RuleSetSnapshot,
} from '@/lib/importer-v2-rule-types'
import { initializeImporterV2WorkspaceAutomation } from '@/lib/importer-v2-workspace-maintenance'

export type ImporterV2RuleWizardScope =
  | 'PROFILE'
  | 'CUSTOMER'
  | 'VENDOR'
  | 'MODEL'

export type ImporterV2RuleWizardInput = {
  rowNumber: number
  /** Field that the automation writes. */
  field: ImporterV2Field
  /** Source field that the condition evaluates. Defaults to `field` for old clients. */
  matchField?: ImporterV2Field
  operator: Extract<
    ImporterV2RuleConditionOperator,
    'NORMALIZED_EXACT' | 'PREFIX' | 'CONTAINS' | 'PATTERN' | 'VERSION_MATCH'
  >
  matchValue: string
  target: { id: string | null; label: string }
  scope: ImporterV2RuleWizardScope
  name?: string | null
  explanation?: string | null
}

function clean(value: string | null | undefined) {
  const result = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return result || null
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    )
  }
  return value
}

function hash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex')
}

async function ensureRuleBook(batch: {
  id: string
  provider: string
  profileId: string
  ruleBookId: string | null
}) {
  if (batch.ruleBookId) return batch.ruleBookId
  const name = `Importer v2 · ${batch.provider} · ${batch.profileId}`
  let book = await prisma.importerV2RuleBook.findUnique({ where: { name } })
  if (!book) {
    book = await prisma.importerV2RuleBook.create({
      data: {
        name,
        activeRevisionVersion: 1,
        revisions: {
          create: {
            version: 1,
            rules: [],
            reason: 'Automatic rule book for this confirmed importer source profile.',
          },
        },
      },
    })
  }
  await prisma.importerV2WorkspaceBatch.update({
    where: { id: batch.id },
    data: { ruleBookId: book.id },
  })
  return book.id
}

async function activeRuleSet(ruleBookId: string): Promise<ImporterV2RuleSetSnapshot> {
  const active = await getActiveImporterV2RuleSet(ruleBookId)
  if (!active) throw new Error('The importer rule book has no active revision.')
  return active
}

function rawValues(evaluated: unknown) {
  return (
    evaluated as {
      rawValues?: Partial<Record<ImporterV2Field, string | null>>
    }
  ).rawValues ?? {}
}

function ruleScope(input: {
  batch: { provider: string; sourceAdapterId: string; profileId: string }
  rowValues: Partial<Record<ImporterV2Field, string | null>>
  scope: ImporterV2RuleWizardScope
  targetField: ImporterV2Field
}): ImporterV2RuleScope {
  const scope: ImporterV2RuleScope = {
    profileIds: [input.batch.profileId],
    providers: [input.batch.provider],
    sourceAdapterIds: [input.batch.sourceAdapterId],
    // `sourceFields` in the current rule matcher constrains action fields. Keep
    // this bound to the field being written; the condition itself carries the
    // independent source/match field.
    sourceFields: [input.targetField],
  }
  if (input.scope === 'CUSTOMER' && clean(input.rowValues.customer)) {
    scope.customers = [clean(input.rowValues.customer)!]
  }
  if (input.scope === 'VENDOR' && clean(input.rowValues.vendor)) {
    scope.vendors = [clean(input.rowValues.vendor)!]
  }
  if (input.scope === 'MODEL' && clean(input.rowValues.model)) {
    scope.models = [clean(input.rowValues.model)!]
  }
  return scope
}

function candidateRule(input: {
  batch: { provider: string; sourceAdapterId: string; profileId: string }
  rowValues: Partial<Record<ImporterV2Field, string | null>>
  wizard: ImporterV2RuleWizardInput
}): ImporterV2RuleDefinition {
  const matchValue = clean(input.wizard.matchValue)
  const targetLabel = clean(input.wizard.target.label)
  const matchField = input.wizard.matchField ?? input.wizard.field
  if (!matchValue) throw new Error('Enter a source pattern to match.')
  if (!targetLabel) throw new Error('Choose or enter the value that the rule should set.')
  if (matchValue.length > 160) throw new Error('Rule patterns are limited to 160 characters.')

  const identity = hash({
    field: input.wizard.field,
    matchField,
    operator: input.wizard.operator,
    matchValue,
    target: input.wizard.target,
    scope: input.wizard.scope,
    profileId: input.batch.profileId,
  }).slice(0, 16)

  return {
    id: `wizard-${identity}`,
    version: 1,
    name:
      clean(input.wizard.name) ??
      `${matchField}: ${input.wizard.operator.toLocaleLowerCase()} ${matchValue} → ${input.wizard.field}`,
    description:
      clean(input.wizard.explanation) ??
      'Created from the Importer v2 guided automation wizard.',
    priority: 100,
    status: 'ACTIVE',
    scope: ruleScope({
      batch: input.batch,
      rowValues: input.rowValues,
      scope: input.wizard.scope,
      targetField: input.wizard.field,
    }),
    when: {
      kind: 'CONDITION',
      field: matchField,
      operator: input.wizard.operator,
      value: matchValue,
    },
    actions: [
      {
        type: 'MAP_VALUE',
        field: input.wizard.field,
        target: { id: input.wizard.target.id, label: targetLabel },
      },
    ],
  }
}

async function previewContext(batchId: string, wizard: ImporterV2RuleWizardInput) {
  const batch = await prisma.importerV2WorkspaceBatch.findUniqueOrThrow({
    where: { id: batchId },
  })
  const ruleBookId = await ensureRuleBook({
    id: batch.id,
    provider: batch.provider,
    profileId: batch.profileId,
    ruleBookId: batch.ruleBookId,
  })
  const [active, currentRow, rows] = await Promise.all([
    activeRuleSet(ruleBookId),
    prisma.importerV2WorkspaceRow.findUniqueOrThrow({
      where: { batchId_rowNumber: { batchId, rowNumber: wizard.rowNumber } },
      select: { evaluated: true },
    }),
    prisma.importerV2WorkspaceRow.findMany({
      where: { batchId, inclusion: 'INCLUDED' },
      orderBy: { rowNumber: 'asc' },
      select: { rowNumber: true, evaluated: true },
    }),
  ])
  const candidate = candidateRule({
    batch: {
      provider: batch.provider,
      sourceAdapterId: batch.sourceAdapterId,
      profileId: batch.profileId,
    },
    rowValues: rawValues(currentRow.evaluated),
    wizard,
  })
  const stagedRows: ImporterV2StagedRow[] = rows.map((row) => ({
    rowNumber: row.rowNumber,
    rawValues: rawValues(row.evaluated),
  }))
  const preview = previewImporterV2RuleChange({
    baseRuleSet: active,
    candidateRule: candidate,
    rows: stagedRows,
    context: {
      profileId: batch.profileId,
      provider: batch.provider,
      sourceAdapterId: batch.sourceAdapterId,
    },
    sampleLimit: 10,
  })
  const scopeToken = hash({
    activeRevisionId: active.revisionId,
    candidate,
    matchedRowCount: preview.matchedRowCount,
    conflicts: preview.conflicts,
  })
  return { ruleBookId, active, candidate, preview, scopeToken }
}

export async function previewImporterV2GuidedRule(input: {
  batchId: string
  wizard: ImporterV2RuleWizardInput
}) {
  const result = await previewContext(input.batchId, input.wizard)
  return {
    scopeToken: result.scopeToken,
    rule: result.candidate,
    preview: result.preview,
  }
}

export async function applyImporterV2GuidedRule(input: {
  batchId: string
  wizard: ImporterV2RuleWizardInput
  scopeToken: string
  actorUserId?: string | null
}) {
  const result = await previewContext(input.batchId, input.wizard)
  if (result.scopeToken !== input.scopeToken) {
    throw new Error(
      'The staged batch or active rule set changed after preview. Preview the automation again.',
    )
  }
  if (result.preview.matchedRowCount === 0) {
    throw new Error('This automation matches no staged rows.')
  }
  if (result.preview.conflicts.length > 0) {
    throw new Error(
      'Resolve the displayed equal-priority rule conflict before activating this automation.',
    )
  }

  const nextRules = [
    ...result.active.rules.filter((rule) => rule.id !== result.candidate.id),
    result.candidate,
  ]
  const revision = await replaceImporterV2RuleSet(result.ruleBookId, {
    rules: nextRules,
    createdByUserId: input.actorUserId ?? null,
    reason: `Guided importer automation: ${result.candidate.name}`,
    activate: true,
  })
  const automation = await initializeImporterV2WorkspaceAutomation(input.batchId)
  return {
    rule: result.candidate,
    revision: { id: revision.revisionId, version: revision.version },
    preview: result.preview,
    automation,
  }
}