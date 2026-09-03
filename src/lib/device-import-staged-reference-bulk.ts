import type { DeviceImportReferenceKind } from '@/lib/device-import'
import { saveImportReferenceAlias } from '@/lib/device-import-reference-store'
import {
  DeviceImportBulkInputError,
  parseBulkReferenceResolutionInput,
} from '@/lib/device-import-staged-reference-bulk-input'
import { refreshDeviceImportBatchReferences, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'

const WRITE_CONCURRENCY = 25

type BatchRecord = {
  id: string
  profileId: string | null
  status: string
}

type StagedReferenceRecord = {
  id: string
  batchId: string
  kind: string
  sourceValue: string
  metadata: unknown
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? (value as DeviceImportStagedReferenceMetadata) : {}
}

export function stagedReferenceAliasContext(reference: { kind: string; metadata: unknown }) {
  const meta = metadata(reference.metadata)
  if (reference.kind === 'SITE') return meta.customerTargetId ?? ''
  if (reference.kind === 'DEVICE_MODEL') return meta.vendorTargetId ?? ''
  if (reference.kind === 'FIRMWARE_RELEASE') {
    const platform = normalizedPlatform(meta.platform ?? '')
    // Firmware proposals can infer their platform from the resolved Model or a
    // profile rule even when the original staged row had no Platform value.
    // A partial "vendor|" context is not canonical and caused an otherwise
    // valid selected release to fail alias validation. Passing no context lets
    // saveImportReferenceAlias derive the canonical Vendor + Platform context
    // from the explicitly selected release after this reference is validated.
    return meta.vendorTargetId && platform ? `${meta.vendorTargetId}|${platform}` : ''
  }
  return ''
}

export function linkedFirmwareReferenceMetadata(
  value: unknown,
  target: { vendorId: string; platform: string },
): DeviceImportStagedReferenceMetadata {
  const current = metadata(value)
  const platforms = [...(current.platforms ?? [])]
  if (!platforms.some((platform) => normalizedPlatform(platform) === normalizedPlatform(target.platform))) {
    platforms.push(target.platform)
  }
  return {
    ...current,
    vendorTargetId: target.vendorId,
    platform: target.platform,
    platforms,
    waitingFor: [],
  }
}

async function validateOneTimeTarget(reference: StagedReferenceRecord, targetId: string) {
  const kind = reference.kind as DeviceImportReferenceKind
  const meta = metadata(reference.metadata)

  if (kind === 'CUSTOMER') {
    const target = await prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Customer target for “${reference.sourceValue}” no longer exists or is archived.`)
    return null
  }
  if (kind === 'SITE') {
    const target = await prisma.site.findUnique({ where: { id: targetId }, select: { id: true, customerId: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Site target for “${reference.sourceValue}” no longer exists or is archived.`)
    if (!meta.customerTargetId || target.customerId !== meta.customerTargetId) {
      throw new DeviceImportStagingError(`Site target for “${reference.sourceValue}” belongs to another customer.`)
    }
    return null
  }
  if (kind === 'VENDOR') {
    const target = await prisma.vendor.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Vendor target for “${reference.sourceValue}” no longer exists or is archived.`)
    return null
  }
  if (kind === 'DEVICE_TYPE') {
    const target = await prisma.deviceType.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Device Type target for “${reference.sourceValue}” no longer exists or is archived.`)
    return null
  }
  if (kind === 'DEVICE_MODEL') {
    const target = await prisma.deviceModel.findUnique({
      where: { id: targetId },
      select: { id: true, vendorId: true, deviceTypeId: true, isActive: true },
    })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Model target for “${reference.sourceValue}” no longer exists or is archived.`)
    if (meta.vendorTargetId && target.vendorId !== meta.vendorTargetId) {
      throw new DeviceImportStagingError(`Model target for “${reference.sourceValue}” belongs to another vendor.`)
    }
    if (meta.deviceTypeTargetId && target.deviceTypeId !== meta.deviceTypeTargetId) {
      throw new DeviceImportStagingError(`Model target for “${reference.sourceValue}” belongs to another device type.`)
    }
    return null
  }
  if (kind === 'CONTRACT_TYPE') {
    const target = await prisma.contractType.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Contract target for “${reference.sourceValue}” no longer exists or is archived.`)
    return null
  }

  const target = await prisma.firmwareRelease.findUnique({
    where: { id: targetId },
    select: { id: true, vendorId: true, platform: true, isActive: true },
  })
  if (!target || !target.isActive) throw new DeviceImportStagingError(`Firmware target for “${reference.sourceValue}” no longer exists or is archived.`)
  if (meta.vendorTargetId && target.vendorId !== meta.vendorTargetId) {
    throw new DeviceImportStagingError(`Firmware target for “${reference.sourceValue}” belongs to another vendor.`)
  }
  if (meta.platform && normalizedPlatform(target.platform) !== normalizedPlatform(meta.platform)) {
    throw new DeviceImportStagingError(`Firmware target for “${reference.sourceValue}” is not compatible with the resolved model platform.`)
  }
  if (!meta.platform && meta.modelTargetId) {
    const model = await prisma.deviceModel.findUnique({
      where: { id: meta.modelTargetId },
      select: {
        platform: true,
        supportedPlatforms: { select: { platform: true } },
      },
    })
    if (model) {
      const allowedPlatforms = new Set([
        model.platform,
        ...model.supportedPlatforms.map((entry) => entry.platform),
      ].map((platform) => normalizedPlatform(platform ?? '')).filter(Boolean))
      if (allowedPlatforms.size && !allowedPlatforms.has(normalizedPlatform(target.platform))) {
        throw new DeviceImportStagingError(`Firmware target for “${reference.sourceValue}” is not compatible with the resolved model platform.`)
      }
    }
  }

  // The worksheet can infer a concrete Platform even when the staged source
  // reference did not contain one. Persist the explicitly accepted release's
  // canonical Vendor + Platform before the dependency refresh. Otherwise the
  // refresh rebuilt a partial Vendor-only context and the just-approved link
  // became unresolved again.
  return linkedFirmwareReferenceMetadata(meta, target)
}

async function inChunks<T>(items: T[], action: (item: T) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(index, index + WRITE_CONCURRENCY).map(action))
  }
}

export async function resolveDeviceImportStagedReferencesBulk(rawInput: unknown) {
  const rawRecord = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const deferRefresh = rawRecord.deferRefresh === true
  let parsed
  try {
    parsed = parseBulkReferenceResolutionInput(rawInput)
  } catch (error) {
    if (error instanceof DeviceImportBulkInputError) throw new DeviceImportStagingError(error.message)
    throw error
  }
  const { batchId, items } = parsed

  const [batch, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true, profileId: true, status: true },
    }) as Promise<BatchRecord | null>,
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, id: { in: items.map((item) => item.referenceId) } },
      select: { id: true, batchId: true, kind: true, sourceValue: true, metadata: true },
    }) as Promise<StagedReferenceRecord[]>,
  ])

  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  if (references.length !== items.length) throw new DeviceImportStagingError('One or more staged references no longer exist in this batch.')

  const referencesById = new Map(references.map((reference) => [reference.id, reference]))
  const linkedMetadata = new Map<string, DeviceImportStagedReferenceMetadata>()

  await inChunks(items, async (item) => {
    const reference = referencesById.get(item.referenceId)!
    // Remembered mappings must pass the same source-context validation as
    // one-time links. Remembering changes reuse behavior; it must not weaken
    // Vendor/Model/Firmware compatibility checks.
    const canonicalMetadata = await validateOneTimeTarget(reference, item.targetId)
    if (canonicalMetadata) linkedMetadata.set(reference.id, canonicalMetadata)
    if (item.remember) {
      await saveImportReferenceAlias({
        profileId: batch.profileId,
        kind: reference.kind,
        sourceValue: reference.sourceValue,
        contextKey: stagedReferenceAliasContext({
          kind: reference.kind,
          metadata: canonicalMetadata ?? reference.metadata,
        }),
        targetId: item.targetId,
      })
    }
  })

  await inChunks(items, async (item) => {
    const canonicalMetadata = linkedMetadata.get(item.referenceId)
    await prisma.deviceImportStagedReference.update({
      where: { id: item.referenceId },
      data: {
        status: 'LINKED',
        targetId: item.targetId,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: 'USER',
        ...(canonicalMetadata ? { metadata: canonicalMetadata } : {}),
      },
    })
  })

  // Prepared-action orchestration can defer this and perform one dependency
  // refresh after the whole dependency layer has been applied.
  if (deferRefresh) return null
  return refreshDeviceImportBatchReferences(batchId)
}