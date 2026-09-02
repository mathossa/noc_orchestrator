import { normalizeImportText, parseDeviceImportOptions, splitOrganizationSite } from '@/lib/device-import'
import { isGenericImportSiteValue } from '@/lib/device-import-site-code'
import {
  buildDeviceImportStagedReferenceSeeds,
  type DeviceImportMappedValues,
  type DeviceImportStagedReferenceMetadata,
} from '@/lib/device-import-staging'
import { refreshDeviceImportBatchReferences, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

const ROW_UPDATE_CONCURRENCY = 40
const INSERT_CHUNK = 500

type SiteReference = {
  id: string
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  metadata: unknown
  status: string
  targetId: string | null
  resolutionSource: string | null
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function asMappedValues(value: unknown) {
  return value as DeviceImportMappedValues
}

function derivedSite(values: DeviceImportMappedValues, delimiter: string) {
  if (!values.site || !values.organizationSite || !isGenericImportSiteValue(values.site)) return null
  const split = splitOrganizationSite(values.organizationSite, delimiter)
  if (!split.site || isGenericImportSiteValue(split.site)) return null
  return split.site
}

export async function countNormalizableStagedGenericSites(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { settings: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') return 0
  const options = parseDeviceImportOptions(batch.settings)
  const rows = await prisma.deviceImportStagedRow.findMany({ where: { batchId }, select: { mappedData: true } })
  return rows.reduce((count, row) => count + (derivedSite(asMappedValues(row.mappedData), options.organizationSiteDelimiter) ? 1 : 0), 0)
}

function legacySiteLinkKey(sourceValue: string, meta: DeviceImportStagedReferenceMetadata) {
  return `${normalizeImportText(sourceValue)}|${normalizeImportText(meta.customerSourceValue)}`
}

export async function normalizeExistingStagedGenericSites(batchId: string) {
  const [batch, rows, oldSiteReferences, customerReferences] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { settings: true, status: true } }),
    prisma.deviceImportStagedRow.findMany({
      where: { batchId },
      orderBy: { rowNumber: 'asc' },
      select: { id: true, rowNumber: true, mappedData: true },
    }),
    prisma.deviceImportStagedReference.findMany({ where: { batchId, kind: 'SITE' } }) as Promise<SiteReference[]>,
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, kind: 'CUSTOMER', status: 'LINKED', targetId: { not: null } },
      select: { normalizedSourceValue: true, targetId: true },
    }),
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  const options = parseDeviceImportOptions(batch.settings)

  const mappedRows = rows.map((row) => ({ rowNumber: row.rowNumber, values: { ...asMappedValues(row.mappedData) } }))
  const updates: Array<{ id: string; mappedData: DeviceImportMappedValues }> = []
  for (let index = 0; index < mappedRows.length; index += 1) {
    const nextSite = derivedSite(mappedRows[index].values, options.organizationSiteDelimiter)
    if (!nextSite) continue
    mappedRows[index].values.site = nextSite
    updates.push({ id: rows[index].id, mappedData: mappedRows[index].values })
  }
  if (!updates.length) return { normalizedRows: 0, rebuiltSiteReferences: oldSiteReferences.length, workspace: await refreshDeviceImportBatchReferences(batchId) }

  const customerTargetBySource = new Map(
    customerReferences.flatMap((reference) => reference.targetId ? [[reference.normalizedSourceValue, reference.targetId] as const] : []),
  )
  const preservedLinks = new Map<string, Set<string>>()
  for (const reference of oldSiteReferences) {
    if (reference.status !== 'LINKED' || !reference.targetId) continue
    const key = legacySiteLinkKey(reference.sourceValue, metadata(reference.metadata))
    const targets = preservedLinks.get(key) ?? new Set<string>()
    targets.add(reference.targetId)
    preservedLinks.set(key, targets)
  }

  const seeds = buildDeviceImportStagedReferenceSeeds(mappedRows, options).filter((seed) => seed.kind === 'SITE')
  const referenceData = seeds.map((seed) => {
    const meta = { ...seed.metadata }
    if (!meta.customerTargetId && meta.customerSourceValue) {
      meta.customerTargetId = customerTargetBySource.get(normalizeImportText(meta.customerSourceValue)) ?? null
    }
    const preserved = preservedLinks.get(legacySiteLinkKey(seed.sourceValue, meta))
    const preservedTargetId = preserved?.size === 1 ? [...preserved][0] : null
    return {
      batchId,
      kind: seed.kind,
      sourceValue: seed.sourceValue,
      normalizedSourceValue: seed.normalizedSourceValue,
      contextKey: seed.contextKey,
      metadata: meta,
      occurrenceCount: seed.occurrenceCount,
      status: preservedTargetId ? 'LINKED' : 'UNRESOLVED',
      targetId: preservedTargetId,
      resolutionSource: preservedTargetId ? 'USER' : null,
    }
  })

  for (let index = 0; index < updates.length; index += ROW_UPDATE_CONCURRENCY) {
    await Promise.all(updates.slice(index, index + ROW_UPDATE_CONCURRENCY).map((update) => prisma.deviceImportStagedRow.update({
      where: { id: update.id },
      data: { mappedData: update.mappedData },
    })))
  }

  await prisma.$transaction(async (tx) => {
    await tx.deviceImportStagedReference.deleteMany({ where: { batchId, kind: 'SITE' } })
    for (let index = 0; index < referenceData.length; index += INSERT_CHUNK) {
      await tx.deviceImportStagedReference.createMany({ data: referenceData.slice(index, index + INSERT_CHUNK) })
    }
  })

  return {
    normalizedRows: updates.length,
    rebuiltSiteReferences: referenceData.length,
    workspace: await refreshDeviceImportBatchReferences(batchId),
  }
}
