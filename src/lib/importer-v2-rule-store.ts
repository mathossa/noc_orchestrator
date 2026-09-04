import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { normalizeImporterV2RuleText } from '@/lib/importer-v2-rule-matcher'
import type {
  ImporterV2ExactMappingDefinition,
  ImporterV2RuleDefinition,
  ImporterV2RuleSetSnapshot,
} from '@/lib/importer-v2-rule-types'

type StoredRuleBook = {
  id: string
  name: string
  activeRevisionVersion: number | null
}

type StoredRuleRevision = {
  id: string
  ruleBookId: string
  version: number
  rules: unknown
  reason: string | null
  createdByUserId: string | null
  createdAt: Date
}

type StoredExactMapping = {
  id: string
  mappingKey: string
  version: number
  provider: string
  profileId: string | null
  field: string
  normalizedInput: string
  target: unknown
  explanation: string
  isActive: boolean
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function exactMappingKey(input: {
  provider: string
  profileId?: string | null
  field: string
  normalizedInput: string
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: normalizeImporterV2RuleText(input.provider)?.toLocaleLowerCase('en-US'),
        profileId: input.profileId ?? null,
        field: input.field,
        normalizedInput: normalizeImporterV2RuleText(input.normalizedInput)?.toLocaleLowerCase('en-US'),
      }),
    )
    .digest('hex')
}

function serializeRevision(
  book: StoredRuleBook,
  revision: StoredRuleRevision,
): ImporterV2RuleSetSnapshot {
  return {
    ruleBookId: book.id,
    revisionId: revision.id,
    version: revision.version,
    rules: revision.rules as readonly ImporterV2RuleDefinition[],
  }
}

function serializeExactMapping(record: StoredExactMapping): ImporterV2ExactMappingDefinition {
  return {
    id: record.id,
    mappingKey: record.mappingKey,
    version: record.version,
    provider: record.provider,
    profileId: record.profileId,
    field: record.field as ImporterV2ExactMappingDefinition['field'],
    normalizedInput: record.normalizedInput,
    target: record.target as ImporterV2ExactMappingDefinition['target'],
    explanation: record.explanation,
    isActive: record.isActive,
  }
}

async function loadRevision(ruleBookId: string, version: number) {
  const [book, revision] = await Promise.all([
    prisma.importerV2RuleBook.findUniqueOrThrow({ where: { id: ruleBookId } }),
    prisma.importerV2RuleRevision.findUniqueOrThrow({
      where: { ruleBookId_version: { ruleBookId, version } },
    }),
  ])
  return serializeRevision(book, revision)
}

export async function getActiveImporterV2RuleSet(ruleBookId: string) {
  const book = await prisma.importerV2RuleBook.findUniqueOrThrow({
    where: { id: ruleBookId },
  })
  if (!book.activeRevisionVersion) return null
  const revision = await prisma.importerV2RuleRevision.findUniqueOrThrow({
    where: {
      ruleBookId_version: {
        ruleBookId,
        version: book.activeRevisionVersion,
      },
    },
  })
  return serializeRevision(book, revision)
}

export async function createImporterV2RuleBook(input: {
  id?: string
  name: string
  rules?: readonly ImporterV2RuleDefinition[]
  createdByUserId?: string | null
  reason?: string | null
}) {
  return prisma.$transaction(async (tx) => {
    const book = await tx.importerV2RuleBook.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        name: input.name,
        activeRevisionVersion: 1,
      },
    })
    const revision = await tx.importerV2RuleRevision.create({
      data: {
        ruleBookId: book.id,
        version: 1,
        rules: jsonValue(input.rules ?? []),
        reason: input.reason ?? 'Initial importer rule-book revision',
        createdByUserId: input.createdByUserId ?? null,
      },
    })
    return serializeRevision(book, revision)
  })
}

export async function replaceImporterV2RuleSet(
  ruleBookId: string,
  input: {
    rules: readonly ImporterV2RuleDefinition[]
    createdByUserId?: string | null
    reason: string
    activate?: boolean
  },
) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.importerV2RuleRevision.findFirst({
      where: { ruleBookId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const version = (latest?.version ?? 0) + 1
    const revision = await tx.importerV2RuleRevision.create({
      data: {
        ruleBookId,
        version,
        // Entire revision is replaced intentionally; no JSON merge with the
        // previous revision is performed, preventing stale rule outputs.
        rules: jsonValue(input.rules),
        reason: input.reason,
        createdByUserId: input.createdByUserId ?? null,
      },
    })
    const book = input.activate === false
      ? await tx.importerV2RuleBook.findUniqueOrThrow({ where: { id: ruleBookId } })
      : await tx.importerV2RuleBook.update({
          where: { id: ruleBookId },
          data: { activeRevisionVersion: version },
        })
    return serializeRevision(book, revision)
  })
}

export async function activateImporterV2RuleRevision(
  ruleBookId: string,
  version: number,
) {
  await prisma.importerV2RuleRevision.findUniqueOrThrow({
    where: { ruleBookId_version: { ruleBookId, version } },
  })
  await prisma.importerV2RuleBook.update({
    where: { id: ruleBookId },
    data: { activeRevisionVersion: version },
  })
  return loadRevision(ruleBookId, version)
}

export async function listImporterV2RuleRevisions(ruleBookId: string) {
  return prisma.importerV2RuleRevision.findMany({
    where: { ruleBookId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      reason: true,
      createdByUserId: true,
      createdAt: true,
    },
  })
}

export async function listActiveImporterV2ExactMappings(input: {
  provider: string
  profileId?: string | null
}) {
  const records = await prisma.importerV2ExactMapping.findMany({
    where: {
      provider: input.provider,
      isActive: true,
      OR: [{ profileId: null }, { profileId: input.profileId ?? null }],
    },
    orderBy: [{ field: 'asc' }, { normalizedInput: 'asc' }, { id: 'asc' }],
  })
  return records.map(serializeExactMapping)
}

export async function rememberImporterV2ExactMapping(input: {
  provider: string
  profileId?: string | null
  field: ImporterV2ExactMappingDefinition['field']
  normalizedInput: string
  target: ImporterV2ExactMappingDefinition['target']
  explanation: string
  createdByUserId?: string | null
}) {
  const normalizedInput = normalizeImporterV2RuleText(input.normalizedInput)
  if (!normalizedInput) throw new Error('Exact mapping requires a normalized input value.')
  const mappingKey = exactMappingKey({ ...input, normalizedInput })

  return prisma.$transaction(async (tx) => {
    const latest = await tx.importerV2ExactMapping.findFirst({
      where: { mappingKey },
      orderBy: { version: 'desc' },
    })
    if (latest?.isActive) {
      await tx.importerV2ExactMapping.update({
        where: { id: latest.id },
        data: { isActive: false },
      })
    }
    const created = await tx.importerV2ExactMapping.create({
      data: {
        mappingKey,
        version: (latest?.version ?? 0) + 1,
        provider: input.provider,
        profileId: input.profileId ?? null,
        field: input.field,
        normalizedInput,
        target: jsonValue(input.target),
        explanation: input.explanation,
        isActive: true,
        createdByUserId: input.createdByUserId ?? null,
      },
    })
    return serializeExactMapping(created)
  })
}
