import {
  importResolutionKey,
  parseDeviceImportOptions,
  type DeviceImportField,
  type DeviceImportPreview,
  type DeviceImportReferenceKind,
  type DeviceImportResult,
} from '@/lib/device-import'
import { commitDeviceImport, previewDeviceImport } from '@/lib/device-import-store'
import {
  stagedFirmwareEvidenceContext,
  stagedFirmwareLegacyRawContext,
} from '@/lib/device-import-staged-firmware-platforms'
import type { DeviceImportMappedValues, DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type BatchRecord = {
  id: string
  profileId: string | null
  fileName: string
  sheetName: string
  headerRow: number
  settings: unknown
  status: string
}

type PublicationFirmwareReference = {
  kind: string
  normalizedSourceValue: string
  contextKey: string
  resolutionSource: string | null
  targetId?: string | null
  metadata?: unknown
}

type PublicationSiteTarget = {
  id: string
  customerId: string
}

type PublicationModelTarget = {
  id: string
  vendorId: string
}

type PublicationFirmwareTarget = {
  id: string
  vendorId: string
  platform: string
  version: string
}

type PublicationResolutionTarget = {
  customerId?: string | null
  vendorId?: string | null
  platform?: string | null
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

/**
 * Build the context key expected by the canonical import resolver.
 *
 * A staged reference's accepted target is authoritative. Staged metadata is
 * useful evidence, but it can be incomplete or stale after dependencies are
 * linked/repaired. Publication therefore derives scoped keys from the actual
 * canonical Site/Model/Firmware target whenever possible and only falls back
 * to metadata for backwards compatibility with older staged batches.
 */
export function publicationResolutionContext(
  kind: string,
  rawMetadata: unknown,
  target: PublicationResolutionTarget | null = null,
) {
  const meta = metadata(rawMetadata)
  if (kind === 'SITE') return target?.customerId ?? meta.customerTargetId ?? ''
  if (kind === 'DEVICE_MODEL') return target?.vendorId ?? meta.vendorTargetId ?? ''
  if (kind === 'FIRMWARE_RELEASE') {
    const vendorId = target?.vendorId ?? meta.vendorTargetId ?? null
    const platform = target?.platform ?? meta.platform ?? ''
    return vendorId ? `${vendorId}|${normalizedPlatform(platform)}` : ''
  }
  return ''
}

export function stagedFirmwareReferenceForRow(
  values: DeviceImportMappedValues,
  references: PublicationFirmwareReference[],
) {
  if (!values.currentFirmware) return null
  const sourceValue = values.currentFirmware.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
  const evidenceContext = stagedFirmwareEvidenceContext(values)
  const legacyContext = stagedFirmwareLegacyRawContext(values)
  return references.find((reference) =>
    reference.kind === 'FIRMWARE_RELEASE' &&
    reference.normalizedSourceValue === sourceValue &&
    reference.contextKey === evidenceContext,
  ) ?? references.find((reference) =>
    reference.kind === 'FIRMWARE_RELEASE' &&
    reference.normalizedSourceValue === sourceValue &&
    reference.contextKey === legacyContext,
  ) ?? null
}

export function firmwareValuesForPublication(
  values: DeviceImportMappedValues,
  references: PublicationFirmwareReference[],
  targets: PublicationFirmwareTarget[],
) {
  const reference = stagedFirmwareReferenceForRow(values, references)
  if (!reference) return { currentFirmware: values.currentFirmware, platform: values.platform }
  const referenceMetadata = metadata(reference.metadata)
  if (reference.resolutionSource === 'UNCLASSIFIED_NO_PLATFORM') {
    return { currentFirmware: null, platform: values.platform ?? referenceMetadata.platform ?? null }
  }
  if (!reference.targetId) return { currentFirmware: values.currentFirmware, platform: values.platform ?? referenceMetadata.platform ?? null }
  const target = targets.find((release) => release.id === reference.targetId)
  if (!target) return { currentFirmware: values.currentFirmware, platform: values.platform ?? referenceMetadata.platform ?? null }
  return {
    currentFirmware: target.version,
    platform: values.platform ?? referenceMetadata.platform ?? target.platform,
  }
}

export function isUnclassifiedFirmwareRow(
  values: DeviceImportMappedValues,
  references: PublicationFirmwareReference[],
) {
  return stagedFirmwareReferenceForRow(values, references)?.resolutionSource === 'UNCLASSIFIED_NO_PLATFORM'
}

const PUBLISH_FIELDS = [
  'customer', 'site', 'name', 'hostname', 'serialNumber', 'vendor', 'model', 'deviceType', 'platform',
  'managementAddress', 'currentFirmware', 'contract', 'externalProvider', 'externalId', 'notes',
] as const satisfies readonly DeviceImportField[]

async function publicationInput(batchId: string) {
  const [batch, rows, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId } }) as Promise<BatchRecord | null>,
    prisma.deviceImportStagedRow.findMany({ where: { batchId, status: 'STAGED' }, orderBy: { rowNumber: 'asc' } }),
    prisma.deviceImportStagedReference.findMany({ where: { batchId } }),
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (references.some((reference) => reference.status !== 'LINKED')) {
    throw new DeviceImportStagingError('Resolve all active staged reference values before validating devices.')
  }

  const targetIds = (kind: string) => [...new Set(references
    .filter((reference) => reference.kind === kind && reference.targetId)
    .map((reference) => reference.targetId as string))]
  const siteTargetIds = targetIds('SITE')
  const modelTargetIds = targetIds('DEVICE_MODEL')
  const firmwareTargetIds = targetIds('FIRMWARE_RELEASE')

  const [siteTargets, modelTargets, firmwareTargets] = await Promise.all([
    siteTargetIds.length
      ? prisma.site.findMany({
          where: { id: { in: siteTargetIds } },
          select: { id: true, customerId: true },
        }) as Promise<PublicationSiteTarget[]>
      : Promise.resolve([] as PublicationSiteTarget[]),
    modelTargetIds.length
      ? prisma.deviceModel.findMany({
          where: { id: { in: modelTargetIds } },
          select: { id: true, vendorId: true },
        }) as Promise<PublicationModelTarget[]>
      : Promise.resolve([] as PublicationModelTarget[]),
    firmwareTargetIds.length
      ? prisma.firmwareRelease.findMany({
          where: { id: { in: firmwareTargetIds } },
          select: { id: true, vendorId: true, platform: true, version: true },
        }) as Promise<PublicationFirmwareTarget[]>
      : Promise.resolve([] as PublicationFirmwareTarget[]),
  ])

  const siteTargetById = new Map(siteTargets.map((site) => [site.id, site]))
  const modelTargetById = new Map(modelTargets.map((model) => [model.id, model]))
  const firmwareTargetById = new Map(firmwareTargets.map((release) => [release.id, release]))

  const resolutions: Record<string, string> = {}
  for (const reference of references) {
    if (!reference.targetId) continue

    const target = reference.kind === 'SITE'
      ? siteTargetById.get(reference.targetId) ?? null
      : reference.kind === 'DEVICE_MODEL'
        ? modelTargetById.get(reference.targetId) ?? null
        : reference.kind === 'FIRMWARE_RELEASE'
          ? firmwareTargetById.get(reference.targetId) ?? null
          : null
    const context = publicationResolutionContext(reference.kind, reference.metadata, target)

    resolutions[importResolutionKey(
      reference.kind as DeviceImportReferenceKind,
      reference.sourceValue,
      context,
    )] = reference.targetId
    if (reference.kind === 'FIRMWARE_RELEASE') {
      const firmwareTarget = firmwareTargetById.get(reference.targetId)
      if (firmwareTarget) {
        const canonicalContext = publicationResolutionContext(reference.kind, reference.metadata, firmwareTarget)
        resolutions[importResolutionKey('FIRMWARE_RELEASE', firmwareTarget.version, canonicalContext)] = firmwareTarget.id
      }
    }
  }

  const stored = parseDeviceImportOptions(batch.settings)
  const mapping = Object.fromEntries(PUBLISH_FIELDS.map((field, index) => [String(index), field]))
  const options = parseDeviceImportOptions({
    ...stored,
    sheetName: batch.sheetName,
    headerRow: batch.headerRow,
    mapping,
    resolutions,
  })
  const syntheticRows = [
    { rowNumber: batch.headerRow, values: PUBLISH_FIELDS.map((field) => field) },
    ...rows.map((row) => {
      const values = row.mappedData as unknown as DeviceImportMappedValues
      const firmware = firmwareValuesForPublication(values, references, firmwareTargets)
      const publishValues: DeviceImportMappedValues = {
        ...values,
        currentFirmware: firmware.currentFirmware,
        platform: firmware.platform,
      }
      return {
        rowNumber: row.rowNumber,
        values: PUBLISH_FIELDS.map((field) => publishValues[field] ?? ''),
      }
    }),
  ]
  const workbook: XlsxWorkbook = {
    sheets: [{
      name: batch.sheetName,
      rowCount: rows.length + 1,
      columnCount: PUBLISH_FIELDS.length,
      rows: syntheticRows,
    }],
  }
  return { batch, rows, workbook, options }
}

export async function validateActiveDeviceImportBatch(batchId: string): Promise<DeviceImportPreview> {
  const { batch, workbook, options } = await publicationInput(batchId)
  return previewDeviceImport(workbook, options, batch.fileName)
}

export async function publishActiveDeviceImportBatch(batchId: string, actorUserId: string | null): Promise<DeviceImportResult> {
  const { batch, rows, workbook, options } = await publicationInput(batchId)
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('This import batch has already been published.')
  const preview = await previewDeviceImport(workbook, options, batch.fileName)
  if (preview.counts.error || preview.counts.conflict) {
    throw new DeviceImportStagingError(`The staged batch still has ${preview.counts.error} error row(s) and ${preview.counts.conflict} conflict row(s). Review device validation before publishing.`)
  }

  const result = preview.counts.importable
    ? await commitDeviceImport(workbook, options, { mode: 'ALL_IMPORTABLE' }, batch.fileName, actorUserId)
    : {
        created: 0,
        updated: 0,
        failed: 0,
        skipped: preview.counts.unchanged,
        importedRows: [],
      }

  await prisma.$transaction([
    prisma.deviceImportStagedRow.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { status: 'PUBLISHED', statusSource: 'PUBLISH' },
    }),
    prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ])
  return result
}
