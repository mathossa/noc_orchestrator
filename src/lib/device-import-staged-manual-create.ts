import { bulkCreateDeviceImportCoreReferences } from '@/lib/device-import-staged-core-assist'
import { bulkCreateDeviceImportFirmware } from '@/lib/device-import-staged-firmware-assist'
import { bulkCreateDeviceImportModels } from '@/lib/device-import-staged-model-assist'
import { rememberReviewedBatchReferences } from '@/lib/device-import-staged-profile-aliases'
import { bulkCreateDeviceImportSites } from '@/lib/device-import-staged-site-bulk-create'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportReferenceKind } from '@/lib/device-import'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

function record(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function requiredText(input: Record<string, unknown>, key: string, label: string) {
  const value = typeof input[key] === 'string' ? input[key].normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
  if (!value) throw new DeviceImportStagingError(`${label} is required.`)
  return value
}

function optionalText(input: Record<string, unknown>, key: string) {
  const value = typeof input[key] === 'string' ? input[key].normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
  return value || null
}

function cleanPlatforms(value: unknown, preferred: string | null) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const result = new Map<string, string>()
  for (const candidate of values) {
    if (typeof candidate !== 'string') continue
    const platform = candidate.normalize('NFKC').trim().replace(/\s+/g, ' ')
    if (platform) result.set(platform.toLocaleLowerCase('en-US'), platform)
  }
  if (preferred) result.set(preferred.toLocaleLowerCase('en-US'), preferred)
  return [...result.values()]
}

async function loadReference(batchId: string, referenceId: string) {
  const [batch, reference] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } }),
    prisma.deviceImportStagedReference.findUnique({
      where: { id: referenceId },
      select: { id: true, batchId: true, kind: true, status: true, sourceValue: true, metadata: true },
    }),
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  if (!reference || reference.batchId !== batchId) throw new DeviceImportStagingError('The staged reference was not found in this batch.')
  if (reference.status === 'LINKED') throw new DeviceImportStagingError('This staged reference is already linked.')
  return reference
}

async function prepareReference(referenceId: string, nextMetadata: DeviceImportStagedReferenceMetadata) {
  await prisma.deviceImportStagedReference.update({
    where: { id: referenceId },
    data: {
      status: 'UNRESOLVED',
      targetId: null,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: null,
      metadata: { ...nextMetadata, waitingFor: [] },
    },
  })
}

export async function createMissingImportEntity(batchId: string, referenceId: string, rawInput: unknown) {
  const input = record(rawInput)
  const reference = await loadReference(batchId, referenceId)
  const kind = reference.kind as DeviceImportReferenceKind

  if (kind === 'CUSTOMER' || kind === 'VENDOR' || kind === 'DEVICE_TYPE' || kind === 'CONTRACT_TYPE') {
    const name = requiredText(input, 'name', 'Name')
    const code = requiredText(input, 'code', 'Code')
    await prepareReference(reference.id, metadata(reference.metadata))
    const result = await bulkCreateDeviceImportCoreReferences({
      batchId,
      items: [{ referenceId: reference.id, name, code }],
    })
    await rememberReviewedBatchReferences(batchId, [kind])
    return { kind, ...result }
  }

  if (kind === 'SITE') {
    const customerId = requiredText(input, 'customerId', 'Customer')
    const name = requiredText(input, 'name', 'Site name')
    const code = requiredText(input, 'code', 'Site code')
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, isActive: true } })
    if (!customer?.isActive) throw new DeviceImportStagingError('The selected Customer no longer exists or is archived.')
    await prepareReference(reference.id, { ...metadata(reference.metadata), customerTargetId: customerId })
    const result = await bulkCreateDeviceImportSites({
      batchId,
      items: [{ referenceIds: [reference.id], name, code }],
    })
    await rememberReviewedBatchReferences(batchId, ['SITE'])
    return { kind, ...result }
  }

  if (kind === 'DEVICE_MODEL') {
    const vendorId = requiredText(input, 'vendorId', 'Vendor')
    const deviceTypeId = requiredText(input, 'deviceTypeId', 'Device Type')
    const model = requiredText(input, 'model', 'Model')
    const platform = optionalText(input, 'platform')
    const platforms = cleanPlatforms(input.platforms, platform)
    const familyId = optionalText(input, 'familyId')
    const [vendor, deviceType] = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, isActive: true } }),
      prisma.deviceType.findUnique({ where: { id: deviceTypeId }, select: { id: true, isActive: true } }),
    ])
    if (!vendor?.isActive) throw new DeviceImportStagingError('The selected Vendor no longer exists or is archived.')
    if (!deviceType?.isActive) throw new DeviceImportStagingError('The selected Device Type no longer exists or is archived.')
    await prepareReference(reference.id, {
      ...metadata(reference.metadata),
      vendorTargetId: vendorId,
      deviceTypeTargetId: deviceTypeId,
      platform,
      platforms,
    })
    const result = await bulkCreateDeviceImportModels({
      batchId,
      items: [{ referenceId: reference.id, model, platform, platforms, familyId }],
    })
    await rememberReviewedBatchReferences(batchId, ['DEVICE_MODEL'])
    return { kind, ...result }
  }

  if (kind === 'FIRMWARE_RELEASE') {
    const vendorId = requiredText(input, 'vendorId', 'Vendor')
    const modelId = requiredText(input, 'modelId', 'Model')
    const platform = requiredText(input, 'platform', 'Platform')
    const version = requiredText(input, 'version', 'Version')
    const status = optionalText(input, 'status')?.toUpperCase() ?? 'AVAILABLE'
    const [vendor, model] = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, isActive: true } }),
      prisma.deviceModel.findUnique({ where: { id: modelId }, select: { id: true, vendorId: true, isActive: true } }),
    ])
    if (!vendor?.isActive) throw new DeviceImportStagingError('The selected Vendor no longer exists or is archived.')
    if (!model?.isActive) throw new DeviceImportStagingError('The selected Model no longer exists or is archived.')
    if (model.vendorId !== vendorId) throw new DeviceImportStagingError('The selected Model belongs to another Vendor.')
    await prepareReference(reference.id, {
      ...metadata(reference.metadata),
      vendorTargetId: vendorId,
      modelTargetId: modelId,
      platform,
      platforms: [platform],
    })
    const result = await bulkCreateDeviceImportFirmware({
      batchId,
      items: [{ referenceIds: [reference.id], version, platform, status }],
    })
    await rememberReviewedBatchReferences(batchId, ['FIRMWARE_RELEASE'])
    return { kind, ...result }
  }

  throw new DeviceImportStagingError(`Manual creation is not supported for staged reference type ${reference.kind}.`)
}
