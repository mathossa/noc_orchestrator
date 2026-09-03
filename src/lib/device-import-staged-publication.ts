import {
  importResolutionKey,
  normalizeImportText,
  parseDeviceImportOptions,
  type DeviceImportField,
  type DeviceImportPreview,
  type DeviceImportReferenceKind,
  type DeviceImportResult,
} from '@/lib/device-import'
import { commitDeviceImport, previewDeviceImport } from '@/lib/device-import-store'
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

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function aliasContext(kind: string, rawMetadata: unknown) {
  const meta = metadata(rawMetadata)
  if (kind === 'SITE') return meta.customerTargetId ?? ''
  if (kind === 'DEVICE_MODEL') return meta.vendorTargetId ?? ''
  if (kind === 'FIRMWARE_RELEASE') {
    return meta.vendorTargetId ? `${meta.vendorTargetId}|${normalizedPlatform(meta.platform ?? '')}` : ''
  }
  return ''
}

function rawFirmwareContext(values: DeviceImportMappedValues) {
  return `vendor:${normalizeImportText(values.vendor)}|model:${normalizeImportText(values.model)}|platform:${normalizeImportText(values.platform)}`
}

export function isUnclassifiedFirmwareRow(
  values: DeviceImportMappedValues,
  references: Array<{
    kind: string
    normalizedSourceValue: string
    contextKey: string
    resolutionSource: string | null
  }>,
) {
  if (!values.currentFirmware) return false
  const sourceValue = normalizeImportText(values.currentFirmware)
  const contextKey = rawFirmwareContext(values)
  return references.some((reference) =>
    reference.kind === 'FIRMWARE_RELEASE' &&
    reference.resolutionSource === 'UNCLASSIFIED_NO_PLATFORM' &&
    reference.normalizedSourceValue === sourceValue &&
    reference.contextKey === contextKey,
  )
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

  const resolutions: Record<string, string> = {}
  for (const reference of references) {
    if (!reference.targetId) continue
    resolutions[importResolutionKey(
      reference.kind as DeviceImportReferenceKind,
      reference.sourceValue,
      aliasContext(reference.kind, reference.metadata),
    )] = reference.targetId
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
      const unclassifiedFirmware = isUnclassifiedFirmwareRow(values, references)
      return {
        rowNumber: row.rowNumber,
        values: PUBLISH_FIELDS.map((field) => field === 'currentFirmware' && unclassifiedFirmware ? '' : values[field] ?? ''),
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
