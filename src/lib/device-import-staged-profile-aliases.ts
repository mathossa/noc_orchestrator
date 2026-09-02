import { normalizeImportText, type DeviceImportReferenceKind } from '@/lib/device-import'
import { prisma } from '@/lib/prisma'

const ALIAS_CHUNK = 200

type ProfileAliasInput = {
  kind: DeviceImportReferenceKind
  sourceValue: string
  contextKey: string
  targetId: string
}

export async function rememberReviewedImportAliases(profileId: string | null, inputs: ProfileAliasInput[]) {
  if (!profileId || !inputs.length) return
  const deduped = new Map<string, ProfileAliasInput & { normalizedSourceValue: string }>()
  for (const input of inputs) {
    const normalizedSourceValue = normalizeImportText(input.sourceValue)
    if (!normalizedSourceValue) continue
    deduped.set(`${input.kind}|${input.contextKey}|${normalizedSourceValue}`, { ...input, normalizedSourceValue })
  }
  const aliases = [...deduped.values()]
  for (let index = 0; index < aliases.length; index += ALIAS_CHUNK) {
    const chunk = aliases.slice(index, index + ALIAS_CHUNK)
    await prisma.$transaction([
      prisma.deviceImportProfileAlias.deleteMany({
        where: {
          profileId,
          OR: chunk.map((alias) => ({
            kind: alias.kind,
            normalizedSourceValue: alias.normalizedSourceValue,
            contextKey: alias.contextKey,
          })),
        },
      }),
      prisma.deviceImportProfileAlias.createMany({
        data: chunk.map((alias) => ({
          profileId,
          kind: alias.kind,
          sourceValue: alias.sourceValue,
          normalizedSourceValue: alias.normalizedSourceValue,
          contextKey: alias.contextKey,
          targetId: alias.targetId,
        })),
      }),
    ])
  }
}
