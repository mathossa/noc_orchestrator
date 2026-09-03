import { normalizeImportText, type DeviceImportReferenceKind } from '@/lib/device-import'
import { hasCompetingFirmwareSourceEvidence } from '@/lib/device-import-staged-firmware-platforms'
import { importSiteProfileContextCandidates } from '@/lib/device-import-site-code'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'

const ALIAS_CHUNK = 200

type ProfileAliasInput = {
  kind: DeviceImportReferenceKind
  sourceValue: string
  contextKey: string
  targetId: string
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function contextKeys(kind: DeviceImportReferenceKind, value: unknown, sourceValue: string) {
  const meta = metadata(value)
  if (kind === 'SITE') {
    return meta.customerTargetId
      ? importSiteProfileContextCandidates(
          meta.customerTargetId,
          meta.organizationSiteSourceValue,
          sourceValue,
        )
      : ['']
  }
  if (kind === 'DEVICE_MODEL') return [meta.vendorTargetId ?? '']
  if (kind === 'FIRMWARE_RELEASE') {
    return [meta.vendorTargetId ? `${meta.vendorTargetId}|${normalizedPlatform(meta.platform ?? '')}` : '']
  }
  return ['']
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

export async function rememberReviewedBatchReferences(batchId: string, kinds: DeviceImportReferenceKind[]) {
  if (!kinds.length) return
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { profileId: true } })
  if (!batch?.profileId) return
  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: { in: kinds }, status: 'LINKED', targetId: { not: null } },
    select: { kind: true, sourceValue: true, targetId: true, metadata: true },
  })
  await rememberReviewedImportAliases(batch.profileId, references.flatMap((reference) => {
    if (!reference.targetId) return []
    const kind = reference.kind as DeviceImportReferenceKind
    const meta = metadata(reference.metadata)
    // A raw firmware value can legitimately fan out to multiple Software
    // Versions. Such a value is not a stable alias and must be interpreted by
    // the profile's firmware-source rule on every import instead.
    if (kind === 'FIRMWARE_RELEASE' && hasCompetingFirmwareSourceEvidence(reference.sourceValue, meta)) return []
    return contextKeys(kind, reference.metadata, reference.sourceValue).map((contextKey) => ({
      kind,
      sourceValue: reference.sourceValue,
      contextKey,
      targetId: reference.targetId!,
    }))
  }))
}
