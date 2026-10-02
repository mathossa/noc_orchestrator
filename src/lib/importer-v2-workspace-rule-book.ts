import { prisma } from '@/lib/prisma'

export function importerV2WorkspaceRuleBookName(input: {
  provider: string
  profileId: string
}) {
  return `Importer v2 · ${input.provider} · ${input.profileId}`
}

export async function findImporterV2WorkspaceRuleBook(input: {
  provider: string
  profileId: string
}) {
  const name = importerV2WorkspaceRuleBookName(input)
  const matches = await prisma.importerV2RuleBook.findMany({
    where: { name: { equals: name, mode: 'insensitive' } },
    orderBy: [{ activeRevisionVersion: 'desc' }, { updatedAt: 'desc' }],
  })
  return matches[0] ?? null
}

export async function ensureImporterV2WorkspaceRuleBook(input: {
  batchId: string
  provider: string
  profileId: string
  currentRuleBookId: string | null
}) {
  const preferred = await findImporterV2WorkspaceRuleBook({
    provider: input.provider,
    profileId: input.profileId,
  })

  let book = preferred
  if (input.currentRuleBookId) {
    const current = await prisma.importerV2RuleBook.findUnique({
      where: { id: input.currentRuleBookId },
    })
    if (
      current &&
      (!book ||
        (current.activeRevisionVersion ?? 0) >=
          (book.activeRevisionVersion ?? 0))
    ) {
      book = current
    }
  }

  if (!book) {
    book = await prisma.importerV2RuleBook.create({
      data: {
        name: importerV2WorkspaceRuleBookName(input),
        activeRevisionVersion: 1,
        revisions: {
          create: {
            version: 1,
            rules: [],
            reason:
              'Automatic rule book for this confirmed importer source profile.',
          },
        },
      },
    })
  }

  if (input.currentRuleBookId !== book.id) {
    await prisma.importerV2WorkspaceBatch.update({
      where: { id: input.batchId },
      data: { ruleBookId: book.id },
    })
  }
  return book.id
}
