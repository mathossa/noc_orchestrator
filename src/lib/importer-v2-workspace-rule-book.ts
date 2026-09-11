import { prisma } from '@/lib/prisma'

export async function ensureImporterV2WorkspaceRuleBook(input: {
  batchId: string
  provider: string
  profileId: string
  currentRuleBookId: string | null
}) {
  if (input.currentRuleBookId) return input.currentRuleBookId

  const name = `Importer v2 · ${input.provider} · ${input.profileId}`
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
            reason:
              'Automatic rule book for this confirmed importer source profile.',
          },
        },
      },
    })
  }

  await prisma.importerV2WorkspaceBatch.update({
    where: { id: input.batchId },
    data: { ruleBookId: book.id },
  })
  return book.id
}
