import { prisma } from '@/lib/prisma'
import {
  deactivateImporterV2ExactMapping,
  getActiveImporterV2RuleSet,
  replaceImporterV2RuleSet,
} from '@/lib/importer-v2-rule-store'
import type {
  ImporterV2ExactMappingDefinition,
  ImporterV2RuleDefinition,
} from '@/lib/importer-v2-rule-types'

export type ImporterV2AutomationProfileSummary = {
  id: string
  name: string
  version: string
  provider: string
  sourceAdapterId: string
}

export type ImporterV2AutomationRevisionSummary = {
  id: string
  version: number
  reason: string | null
  createdByUserId: string | null
  createdAt: string
  ruleCount: number
}

export type ImporterV2AutomationRuleBookSummary = {
  id: string
  name: string
  activeRevisionVersion: number | null
  updatedAt: string
  rules: readonly ImporterV2RuleDefinition[]
  revisions: readonly ImporterV2AutomationRevisionSummary[]
}

export type ImporterV2AutomationExactMappingSummary =
  ImporterV2ExactMappingDefinition & {
    createdAt: string
    createdByUserId: string | null
    history: readonly {
      id: string
      version: number
      explanation: string
      isActive: boolean
      createdAt: string
      createdByUserId: string | null
    }[]
  }

export type ImporterV2AutomationAdminData = {
  profiles: readonly ImporterV2AutomationProfileSummary[]
  ruleBooks: readonly ImporterV2AutomationRuleBookSummary[]
  exactMappings: readonly ImporterV2AutomationExactMappingSummary[]
}

function ruleCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

export async function getImporterV2AutomationAdminData(): Promise<ImporterV2AutomationAdminData> {
  const [profiles, books, mappings] = await Promise.all([
    prisma.importerV2SourceProfile.findMany({
      orderBy: [{ provider: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        version: true,
        provider: true,
        sourceAdapterId: true,
      },
    }),
    prisma.importerV2RuleBook.findMany({
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      include: {
        revisions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            reason: true,
            createdByUserId: true,
            createdAt: true,
            rules: true,
          },
        },
      },
    }),
    prisma.importerV2ExactMapping.findMany({
      orderBy: [
        { mappingKey: 'asc' },
        { version: 'desc' },
      ],
    }),
  ])

  const ruleBooks = await Promise.all(
    books.map(async (book) => {
      const active = book.activeRevisionVersion
        ? await getActiveImporterV2RuleSet(book.id)
        : null
      return {
        id: book.id,
        name: book.name,
        activeRevisionVersion: book.activeRevisionVersion,
        updatedAt: book.updatedAt.toISOString(),
        rules: active?.rules ?? [],
        revisions: book.revisions.map((revision) => ({
          id: revision.id,
          version: revision.version,
          reason: revision.reason,
          createdByUserId: revision.createdByUserId,
          createdAt: revision.createdAt.toISOString(),
          ruleCount: ruleCount(revision.rules),
        })),
      }
    }),
  )

  const mappingsByKey = new Map<string, typeof mappings>()
  for (const mapping of mappings) {
    mappingsByKey.set(mapping.mappingKey, [
      ...(mappingsByKey.get(mapping.mappingKey) ?? []),
      mapping,
    ])
  }

  const exactMappings = [...mappingsByKey.values()]
    .map((history) => history[0])
    .map((latest) => ({
      id: latest.id,
      mappingKey: latest.mappingKey,
      version: latest.version,
      provider: latest.provider,
      profileId: latest.profileId,
      field: latest.field as ImporterV2ExactMappingDefinition['field'],
      normalizedInput: latest.normalizedInput,
      target: latest.target as ImporterV2ExactMappingDefinition['target'],
      explanation: latest.explanation,
      isActive: latest.isActive,
      createdAt: latest.createdAt.toISOString(),
      createdByUserId: latest.createdByUserId,
      history: (mappingsByKey.get(latest.mappingKey) ?? []).map((record) => ({
        id: record.id,
        version: record.version,
        explanation: record.explanation,
        isActive: record.isActive,
        createdAt: record.createdAt.toISOString(),
        createdByUserId: record.createdByUserId,
      })),
    }))

  return {
    profiles: profiles.map((profile) => ({
      ...profile,
    })),
    ruleBooks,
    exactMappings,
  }
}

export async function mutateImporterV2ManagedRule(input: {
  ruleBookId: string
  ruleId: string
  action: 'ENABLE' | 'DISABLE' | 'REMOVE'
  createdByUserId?: string | null
}) {
  const active = await getActiveImporterV2RuleSet(input.ruleBookId)
  if (!active) throw new Error('This rule book has no active revision.')
  const current = active.rules.find((rule) => rule.id === input.ruleId)
  if (!current) throw new Error('The selected rule is not in the active revision.')

  const rules =
    input.action === 'REMOVE'
      ? active.rules.filter((rule) => rule.id !== input.ruleId)
      : active.rules.map((rule) =>
          rule.id === input.ruleId
            ? {
                ...rule,
                status:
                  input.action === 'ENABLE'
                    ? ('ACTIVE' as const)
                    : ('DISABLED' as const),
              }
            : rule,
        )

  const actionLabel =
    input.action === 'REMOVE'
      ? 'Removed'
      : input.action === 'ENABLE'
        ? 'Enabled'
        : 'Disabled'

  return replaceImporterV2RuleSet(input.ruleBookId, {
    rules,
    createdByUserId: input.createdByUserId ?? null,
    reason: `${actionLabel} importer automation “${current.name}” from Import automation settings.`,
    activate: true,
  })
}

export async function deactivateImporterV2ManagedExactMapping(input: {
  mappingKey: string
  createdByUserId?: string | null
}) {
  return deactivateImporterV2ExactMapping({
    mappingKey: input.mappingKey,
    createdByUserId: input.createdByUserId ?? null,
    explanation:
      'Deactivated remembered exact mapping from Import automation settings.',
  })
}
