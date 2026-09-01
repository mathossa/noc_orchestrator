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

function aliasContext(reference: StagedReferenceRecord) {
  const meta = metadata(reference.metadata)
  if (reference.kind === 'SITE') return meta.customerTargetId ?? ''
  if (reference.kind === 'DEVICE_MODEL') return meta.vendorTargetId ?? ''
  if (reference.kind === 'FIRMWARE_RELEASE') {
    return meta.vendorTargetId ? `${meta.vendorTargetId}|${normalizedPlatform(meta.platform ?? '')}` : ''
  }
  return ''
}

async function validateOneTimeTarget(reference: StagedReferenceRecord, targetId: string) {
  const kind = reference.kind as DeviceImportReferenceKind
  const meta = metadata(reference.metadata)

  if (kind === 'CUSTOMER') {
    const target = await prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Customer target for “${reference.sourceValue}” no longer exists or is archived.`)
    return
  }
  if (kind === 'SITE') {
    const target = await prisma.site.findUnique({ where: { id: targetId }, select: { id: true, customerId: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Site target for “${reference.sourceValue}” no longer exists or is archived.`)
    if (!meta.customerTargetId || target.customerId !== meta.customerTargetId) {
      throw new DeviceImportStagingError(`Site target for “${reference.sourceValue}” belongs to another customer.`)
    }
    return
  }
  if (kind === 'VENDOR') {
    const target = await prisma.vendor.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Vendor target for “${reference.sourceValue}” no longer exists or is archived.`)
    return
  }
  if (kind === 'DEVICE_TYPE') {
    const target = await prisma.deviceType.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Device Type target for “${reference.sourceValue}” no longer exists or is archived.`)
    return
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
    return
  }
  if (kind === 'CONTRACT_TYPE') {
    const target = await prisma.contractType.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError(`Contract target for “${reference.sourceValue}” no longer exists or is archived.`)
    return
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
}

async function inChunks<T>(items: T[], action: (item: T) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(index, index + WRITE_CONCURRENCY).map(action))
  }
}

export async function resolveDeviceImportStagedReferencesBulk(rawInput: unknown) {
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

  await inChunks(items, async (item) => {
    const reference = referencesById.get(item.referenceId)!
    if (item.remember) {
      await saveImportReferenceAlias({
        profileId: batch.profileId,
        kind: reference.kind,
        sourceValue: reference.sourceValue,
        contextKey: aliasContext(reference),
        targetId: item.targetId,
      })
    } else {
      await validateOneTimeTarget(reference, item.targetId)
    }
  })

  await inChunks(items, async (item) => {
    await prisma.deviceImportStagedReference.update({
      where: { id: item.referenceId },
      data: {
        status: 'LINKED',
        targetId: item.targetId,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: 'USER',
      },
    })
  })

  // One dependency refresh for the whole bulk action. This replaces N full request/refresh cycles.
  return refreshDeviceImportBatchReferences(batchId)
}
