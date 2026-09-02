import {
  headersFromRow,
  importResolutionKey,
  mappedRows,
  normalizeImportText,
  parseDeviceImportOptions,
  type DeviceImportField,
  type DeviceImportPreview,
  type DeviceImportReferenceKind,
  type DeviceImportResult,
} from '@/lib/device-import'
import { commitDeviceImport, previewDeviceImport } from '@/lib/device-import-store'
import { saveImportReferenceAlias } from '@/lib/device-import-reference-store'
import {
  bestImportReferenceSuggestion,
  buildDeviceImportStagedReferenceSeeds,
  type DeviceImportMappedValues,
  type DeviceImportStagedReferenceMetadata,
} from '@/lib/device-import-staging'
import { currentLinkedDependencyTarget } from '@/lib/device-import-staging-dependencies'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'

const INSERT_CHUNK = 500
const WORKSPACE_ROW_SAMPLE = 100

export class DeviceImportStagingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportStagingError'
  }
}

type AliasRef = {
  kind: string
  normalizedSourceValue: string
  contextKey: string
  targetId: string
}

type CustomerRef = { id: string; code: string | null; name: string; isActive: boolean }
type SiteRef = { id: string; customerId: string; code: string | null; name: string; isActive: boolean }
type VendorRef = { id: string; code: string; name: string; isActive: boolean }
type TypeRef = { id: string; code: string; name: string; isActive: boolean }
type ModelRef = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId: string | null
  model: string
  platform: string | null
  isActive: boolean
  vendor: VendorRef
  deviceType: TypeRef
}
type ContractRef = { id: string; code: string; name: string; isActive: boolean }
type FirmwareRef = {
  id: string
  vendorId: string
  platform: string
  version: string
  status: string
  isActive: boolean
  vendor: VendorRef
}

type ReferenceUniverse = {
  customers: CustomerRef[]
  sites: SiteRef[]
  vendors: VendorRef[]
  deviceTypes: TypeRef[]
  models: ModelRef[]
  contracts: ContractRef[]
  firmwareReleases: FirmwareRef[]
  aliases: AliasRef[]
}

type StagedReferenceRecord = {
  id: string
  batchId: string
  kind: string
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  metadata: unknown
  status: string
  targetId: string | null
  suggestedTargetId: string | null
  suggestionScore: number | null
  resolutionSource: string | null
  occurrenceCount: number
}

type BatchRecord = {
  id: string
  profileId: string | null
  fileName: string
  sheetName: string
  headerRow: number
  settings: unknown
  status: string
  totalRows: number
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? (value as DeviceImportStagedReferenceMetadata) : {}
}

function exactNameOrCode<T extends { name: string; code?: string | null }>(value: string, records: T[]) {
  const normalized = normalizeImportText(value)
  return records.filter((record) =>
    normalizeImportText(record.name) === normalized || normalizeImportText(record.code) === normalized,
  )
}

function profileAliasTarget(
  kind: DeviceImportReferenceKind,
  sourceValue: string,
  contextKey: string,
  aliases: AliasRef[],
) {
  const normalizedSourceValue = normalizeImportText(sourceValue)
  return aliases.find((alias) =>
    alias.kind === kind &&
    alias.normalizedSourceValue === normalizedSourceValue &&
    alias.contextKey === contextKey,
  )?.targetId ?? null
}

async function loadReferenceUniverse(profileId: string | null): Promise<ReferenceUniverse> {
  const [customers, sites, vendors, deviceTypes, models, contracts, firmwareReleases, aliases] = await Promise.all([
    prisma.customer.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.site.findMany({
      orderBy: [{ isActive: 'desc' }, { customer: { name: 'asc' } }, { name: 'asc' }],
      select: { id: true, customerId: true, code: true, name: true, isActive: true },
    }),
    prisma.vendor.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.deviceType.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.deviceModel.findMany({
      orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { model: 'asc' }],
      select: {
        id: true,
        vendorId: true,
        deviceTypeId: true,
        familyId: true,
        model: true,
        platform: true,
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
        deviceType: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    prisma.contractType.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.firmwareRelease.findMany({
      orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { platform: 'asc' }, { version: 'asc' }],
      select: {
        id: true,
        vendorId: true,
        platform: true,
        version: true,
        status: true,
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    profileId
      ? prisma.deviceImportProfileAlias.findMany({
          where: { profileId },
          select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true },
        })
      : prisma.importReferenceAlias.findMany({
          select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true },
        }),
  ])
  return { customers, sites, vendors, deviceTypes, models, contracts, firmwareReleases, aliases }
}

function suggestion<T extends { id: string }>(sourceValue: string, candidates: T[], label: (candidate: T) => string) {
  const best = bestImportReferenceSuggestion(sourceValue, candidates, label)
  return best ? { targetId: best.candidate.id, score: best.score } : { targetId: null, score: null }
}

function targetExists(kind: DeviceImportReferenceKind, targetId: string, universe: ReferenceUniverse) {
  if (kind === 'CUSTOMER') return universe.customers.some((record) => record.id === targetId && record.isActive)
  if (kind === 'SITE') return universe.sites.some((record) => record.id === targetId && record.isActive)
  if (kind === 'VENDOR') return universe.vendors.some((record) => record.id === targetId && record.isActive)
  if (kind === 'DEVICE_TYPE') return universe.deviceTypes.some((record) => record.id === targetId && record.isActive)
  if (kind === 'DEVICE_MODEL') return universe.models.some((record) => record.id === targetId && record.isActive)
  if (kind === 'CONTRACT_TYPE') return universe.contracts.some((record) => record.id === targetId && record.isActive)
  return universe.firmwareReleases.some((record) => record.id === targetId && record.isActive)
}

function resolveOneReference(
  reference: StagedReferenceRecord,
  references: StagedReferenceRecord[],
  universe: ReferenceUniverse,
) {
  const kind = reference.kind as DeviceImportReferenceKind
  const meta = metadata(reference.metadata)
  let canonicalContext = ''
  let candidates: Array<{ id: string; label: string }> = []
  let waitingFor: DeviceImportReferenceKind[] = []

  if (kind === 'CUSTOMER') {
    const active = universe.customers.filter((record) => record.isActive)
    candidates = active.map((record) => ({ id: record.id, label: record.name }))
    const exact = exactNameOrCode(reference.sourceValue, active)
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: meta }
  } else if (kind === 'VENDOR') {
    const active = universe.vendors.filter((record) => record.isActive)
    const rememberedVendor = profileAliasTarget(kind, reference.sourceValue, '', universe.aliases)
    if (rememberedVendor && targetExists(kind, rememberedVendor, universe)) {
      return { status: 'LINKED', targetId: rememberedVendor, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'PROFILE_ALIAS', metadata: meta }
    }
    candidates = active.map((record) => ({ id: record.id, label: record.name }))
    const exact = exactNameOrCode(reference.sourceValue, active)
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: meta }
  } else if (kind === 'DEVICE_TYPE') {
    const active = universe.deviceTypes.filter((record) => record.isActive)
    candidates = active.map((record) => ({ id: record.id, label: record.name }))
    const exact = exactNameOrCode(reference.sourceValue, active)
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: meta }
  } else if (kind === 'CONTRACT_TYPE') {
    const active = universe.contracts.filter((record) => record.isActive)
    candidates = active.map((record) => ({ id: record.id, label: record.name }))
    const exact = exactNameOrCode(reference.sourceValue, active)
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: meta }
  } else if (kind === 'SITE') {
    const customerTargetId = currentLinkedDependencyTarget('CUSTOMER', meta.customerSourceValue, references, meta.customerTargetId ?? null)
    if (!customerTargetId) {
      waitingFor = ['CUSTOMER']
      return { status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null, metadata: { ...meta, customerTargetId: null, waitingFor } }
    }
    canonicalContext = customerTargetId
    const active = universe.sites.filter((record) => record.isActive && record.customerId === customerTargetId)
    candidates = active.map((record) => ({ id: record.id, label: record.name }))
    const exact = exactNameOrCode(reference.sourceValue, active)
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: { ...meta, customerTargetId, waitingFor: [] } }
    meta.customerTargetId = customerTargetId
  } else if (kind === 'DEVICE_MODEL') {
    const vendorTargetId = currentLinkedDependencyTarget('VENDOR', meta.vendorSourceValue, references, meta.vendorTargetId ?? null)
    const deviceTypeTargetId = currentLinkedDependencyTarget('DEVICE_TYPE', meta.deviceTypeSourceValue, references, meta.deviceTypeTargetId ?? null)
    if (!vendorTargetId && meta.vendorSourceValue) waitingFor.push('VENDOR')
    if (!deviceTypeTargetId && meta.deviceTypeSourceValue) waitingFor.push('DEVICE_TYPE')
    if (waitingFor.length) return { status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null, metadata: { ...meta, vendorTargetId, deviceTypeTargetId, waitingFor } }
    canonicalContext = vendorTargetId ?? ''
    const active = universe.models.filter((record) =>
      record.isActive &&
      (!vendorTargetId || record.vendorId === vendorTargetId) &&
      (!deviceTypeTargetId || record.deviceTypeId === deviceTypeTargetId),
    )
    candidates = active.flatMap((record) => [
      { id: record.id, label: record.model },
      { id: record.id, label: `${record.vendor.name} ${record.model}` },
    ])
    const normalized = normalizeImportText(reference.sourceValue)
    const exact = active.filter((record) =>
      normalizeImportText(record.model) === normalized ||
      normalizeImportText(`${record.vendor.name} ${record.model}`) === normalized,
    )
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: { ...meta, vendorTargetId, deviceTypeTargetId, platform: exact[0].platform, waitingFor: [] } }
    meta.vendorTargetId = vendorTargetId
    meta.deviceTypeTargetId = deviceTypeTargetId
  } else {
    const modelTargetId = currentLinkedDependencyTarget('DEVICE_MODEL', meta.modelSourceValue, references, meta.modelTargetId ?? null)
    if (!modelTargetId && meta.modelSourceValue) waitingFor = ['DEVICE_MODEL']
    if (!modelTargetId) waitingFor = ['DEVICE_MODEL']
    if (waitingFor.length) return { status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null, metadata: { ...meta, modelTargetId: null, waitingFor } }
    const model = universe.models.find((record) => record.id === modelTargetId) ?? null
    if (!model) return { status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null, metadata: { ...meta, modelTargetId, waitingFor: ['DEVICE_MODEL'] } }
    canonicalContext = `${model.vendorId}|${normalizedPlatform(model.platform ?? '')}`
    const active = universe.firmwareReleases.filter((record) =>
      record.isActive &&
      record.vendorId === model.vendorId &&
      (!model.platform || normalizedPlatform(record.platform) === normalizedPlatform(model.platform)),
    )
    candidates = active.map((record) => ({ id: record.id, label: record.version }))
    const exact = active.filter((record) => normalizeImportText(record.version) === normalizeImportText(reference.sourceValue))
    if (exact.length === 1) return { status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT', metadata: { ...meta, modelTargetId, vendorTargetId: model.vendorId, platform: model.platform, waitingFor: [] } }
    meta.modelTargetId = modelTargetId
    meta.vendorTargetId = model.vendorId
    meta.platform = model.platform
  }

  const remembered = profileAliasTarget(kind, reference.sourceValue, canonicalContext, universe.aliases)
  if (remembered && targetExists(kind, remembered, universe)) {
    return {
      status: 'LINKED',
      targetId: remembered,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: 'PROFILE_ALIAS',
      metadata: { ...meta, waitingFor: [] },
    }
  }

  if (reference.targetId && ['USER', 'CREATED'].includes(reference.resolutionSource ?? '') && targetExists(kind, reference.targetId, universe)) {
    const valid = kind === 'SITE'
      ? universe.sites.some((record) => record.id === reference.targetId && record.customerId === canonicalContext)
      : kind === 'DEVICE_MODEL'
        ? universe.models.some((record) => record.id === reference.targetId && (!canonicalContext || record.vendorId === canonicalContext))
        : kind === 'FIRMWARE_RELEASE'
          ? universe.firmwareReleases.some((record) => {
              if (record.id !== reference.targetId) return false
              const expected = `${record.vendorId}|${normalizedPlatform(record.platform)}`
              return !canonicalContext || expected === canonicalContext
            })
          : true
    if (valid) return { status: 'LINKED', targetId: reference.targetId, suggestedTargetId: null, suggestionScore: null, resolutionSource: reference.resolutionSource, metadata: { ...meta, waitingFor: [] } }
  }

  const best = suggestion(reference.sourceValue, candidates, (candidate) => candidate.label)
  return {
    status: 'UNRESOLVED',
    targetId: null,
    suggestedTargetId: best.targetId,
    suggestionScore: best.score,
    resolutionSource: null,
    metadata: { ...meta, waitingFor: [] },
  }
}

async function refreshReferenceRecords(batch: BatchRecord) {
  const universe = await loadReferenceUniverse(batch.profileId)
  const records = await prisma.deviceImportStagedReference.findMany({
    where: { batchId: batch.id },
    orderBy: [{ kind: 'asc' }, { sourceValue: 'asc' }],
  }) as StagedReferenceRecord[]

  const order: DeviceImportReferenceKind[] = [
    'CUSTOMER',
    'VENDOR',
    'DEVICE_TYPE',
    'CONTRACT_TYPE',
    'SITE',
    'DEVICE_MODEL',
    'FIRMWARE_RELEASE',
  ]

  const dirty: Array<{ id: string; resolved: ReturnType<typeof resolveOneReference> }> = []
  for (const kind of order) {
    for (const reference of records.filter((record) => record.kind === kind)) {
      const beforeMetadata = JSON.stringify(reference.metadata ?? null)
      const resolved = resolveOneReference(reference, records, universe)
      const changed =
        reference.status !== resolved.status ||
        reference.targetId !== resolved.targetId ||
        reference.suggestedTargetId !== resolved.suggestedTargetId ||
        reference.suggestionScore !== resolved.suggestionScore ||
        reference.resolutionSource !== resolved.resolutionSource ||
        beforeMetadata !== JSON.stringify(resolved.metadata ?? null)
      Object.assign(reference, resolved)
      if (changed) dirty.push({ id: reference.id, resolved })
    }
  }

  // A full batch can contain thousands of unique staged references. Updating them
  // one-by-one made every dependency refresh take many seconds even when almost
  // nothing changed. Resolve in memory first, then persist only dirty records
  // with bounded concurrency.
  for (let index = 0; index < dirty.length; index += 50) {
    await Promise.all(dirty.slice(index, index + 50).map(({ id, resolved }) =>
      prisma.deviceImportStagedReference.update({
        where: { id },
        data: {
          status: resolved.status,
          targetId: resolved.targetId,
          suggestedTargetId: resolved.suggestedTargetId,
          suggestionScore: resolved.suggestionScore,
          resolutionSource: resolved.resolutionSource,
          metadata: resolved.metadata,
        },
      }),
    ))
  }

  const unresolved = records.filter((record) => record.kind !== 'CONTRACT_TYPE' && record.status !== 'LINKED').length
  await prisma.deviceImportBatch.update({
    where: { id: batch.id },
    data: { status: unresolved === 0 ? 'READY' : 'STAGED' },
  })
  return { records, universe }
}

export async function refreshDeviceImportBatchReferences(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId } }) as BatchRecord | null
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') return getDeviceImportBatchWorkspace(batchId)
  await refreshReferenceRecords(batch)
  return getDeviceImportBatchWorkspace(batchId)
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

export async function createDeviceImportBatch(workbook: XlsxWorkbook, rawOptions: unknown, fileName: string) {
  const options = parseDeviceImportOptions(rawOptions)
  const sheet = workbook.sheets.find((candidate) => candidate.name === options.sheetName)
  if (!sheet) throw new DeviceImportStagingError('The selected worksheet is unavailable.')
  if (options.profileId) {
    const profile = await prisma.deviceImportProfile.findUnique({ where: { id: options.profileId }, select: { id: true, isActive: true } })
    if (!profile || !profile.isActive) throw new DeviceImportStagingError('The selected import profile no longer exists or is archived.')
  }

  const mapped = mappedRows(sheet, options) as Array<{ rowNumber: number; values: DeviceImportMappedValues }>
  if (!mapped.length) throw new DeviceImportStagingError('The selected worksheet does not contain any mapped device rows.')
  const header = sheet.rows.find((row) => row.rowNumber === options.headerRow)
  const headers = headersFromRow(header, sheet.columnCount)
  const rowByNumber = new Map(sheet.rows.map((row) => [row.rowNumber, row]))
  const references = buildDeviceImportStagedReferenceSeeds(mapped, options)

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.deviceImportBatch.create({
      data: {
        profileId: options.profileId,
        fileName,
        sheetName: options.sheetName,
        headerRow: options.headerRow,
        settings: options,
        status: references.length ? 'STAGED' : 'READY',
        totalRows: mapped.length,
      },
      select: { id: true },
    })

    const rowData = mapped.map((row) => {
      const source = rowByNumber.get(row.rowNumber)
      const rawData = Object.fromEntries(headers.map((name, index) => [name, source?.values[index] ?? '']))
      return {
        batchId: created.id,
        rowNumber: row.rowNumber,
        rawData,
        mappedData: row.values,
      }
    })
    for (const part of chunks(rowData, INSERT_CHUNK)) await tx.deviceImportStagedRow.createMany({ data: part })

    const referenceData = references.map((reference) => ({
      batchId: created.id,
      kind: reference.kind,
      sourceValue: reference.sourceValue,
      normalizedSourceValue: reference.normalizedSourceValue,
      contextKey: reference.contextKey,
      metadata: reference.metadata,
      occurrenceCount: reference.occurrenceCount,
    }))
    for (const part of chunks(referenceData, INSERT_CHUNK)) await tx.deviceImportStagedReference.createMany({ data: part })
    return created
  })

  await refreshDeviceImportBatchReferences(batch.id)
  return getDeviceImportBatchWorkspace(batch.id)
}

export async function listDeviceImportBatches() {
  const batches = await prisma.deviceImportBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      profileId: true,
      fileName: true,
      sheetName: true,
      status: true,
      totalRows: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { references: true } },
    },
  })
  const profileIds = [...new Set(batches.map((batch) => batch.profileId).filter((id): id is string => Boolean(id)))]
  const profiles = profileIds.length
    ? await prisma.deviceImportProfile.findMany({ where: { id: { in: profileIds } }, select: { id: true, name: true } })
    : []
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]))
  return batches.map((batch) => ({
    ...batch,
    profileName: batch.profileId ? profileNames.get(batch.profileId) ?? null : null,
    publishedAt: batch.publishedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    referenceCount: batch._count.references,
  }))
}

function targetLabel(kind: string, targetId: string | null, universe: ReferenceUniverse) {
  if (!targetId) return null
  if (kind === 'CUSTOMER') return universe.customers.find((record) => record.id === targetId)?.name ?? null
  if (kind === 'SITE') return universe.sites.find((record) => record.id === targetId)?.name ?? null
  if (kind === 'VENDOR') return universe.vendors.find((record) => record.id === targetId)?.name ?? null
  if (kind === 'DEVICE_TYPE') return universe.deviceTypes.find((record) => record.id === targetId)?.name ?? null
  if (kind === 'DEVICE_MODEL') {
    const record = universe.models.find((model) => model.id === targetId)
    return record ? `${record.vendor.name} · ${record.model}` : null
  }
  if (kind === 'CONTRACT_TYPE') return universe.contracts.find((record) => record.id === targetId)?.name ?? null
  const release = universe.firmwareReleases.find((record) => record.id === targetId)
  return release ? `${release.vendor.name} · ${release.platform} · ${release.version}` : null
}

function resolutionOptions(universe: ReferenceUniverse) {
  return {
    customers: universe.customers,
    sites: universe.sites,
    vendors: universe.vendors,
    deviceTypes: universe.deviceTypes,
    models: universe.models,
    contracts: universe.contracts,
    firmwareReleases: universe.firmwareReleases,
  }
}

export async function getDeviceImportBatchWorkspace(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      profileId: true,
      fileName: true,
      sheetName: true,
      headerRow: true,
      settings: true,
      status: true,
      totalRows: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  }) as BatchRecord | null
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  const [references, rows, universe, profile] = await Promise.all([
    prisma.deviceImportStagedReference.findMany({
      where: { batchId },
      orderBy: [{ kind: 'asc' }, { status: 'desc' }, { sourceValue: 'asc' }],
    }) as Promise<StagedReferenceRecord[]>,
    prisma.deviceImportStagedRow.findMany({
      where: { batchId },
      orderBy: { rowNumber: 'asc' },
      take: WORKSPACE_ROW_SAMPLE,
      select: { id: true, rowNumber: true, rawData: true, mappedData: true, status: true },
    }),
    loadReferenceUniverse(batch.profileId),
    batch.profileId
      ? prisma.deviceImportProfile.findUnique({ where: { id: batch.profileId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ])

  const actionableReferences = references.filter((reference) => reference.kind !== 'CONTRACT_TYPE')
  const byKind = Object.fromEntries([
    'CUSTOMER', 'SITE', 'VENDOR', 'DEVICE_TYPE', 'DEVICE_MODEL', 'FIRMWARE_RELEASE',
  ].map((kind) => {
    const items = actionableReferences.filter((reference) => reference.kind === kind)
    return [kind, {
      total: items.length,
      linked: items.filter((reference) => reference.status === 'LINKED').length,
      unresolved: items.filter((reference) => reference.status === 'UNRESOLVED').length,
      waiting: items.filter((reference) => reference.status === 'WAITING').length,
    }]
  }))
  const linked = actionableReferences.filter((reference) => reference.status === 'LINKED').length
  const unresolved = actionableReferences.length - linked

  return {
    batch: {
      ...batch,
      profileName: profile?.name ?? null,
      publishedAt: batch.publishedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    },
    counts: { references: { total: actionableReferences.length, linked, unresolved, byKind }, rows: { total: batch.totalRows, sample: rows.length } },
    references: actionableReferences.map((reference) => ({
      ...reference,
      targetLabel: targetLabel(reference.kind, reference.targetId, universe),
      suggestedTargetLabel: targetLabel(reference.kind, reference.suggestedTargetId, universe),
      metadata: metadata(reference.metadata),
    })),
    rows,
    options: resolutionOptions(universe),
    canValidate: unresolved === 0 && batch.status !== 'PUBLISHED',
    canPublish: unresolved === 0 && batch.status !== 'PUBLISHED',
  }
}

async function validateOneTimeTarget(reference: StagedReferenceRecord, targetId: string, universe: ReferenceUniverse) {
  const kind = reference.kind as DeviceImportReferenceKind
  if (!targetExists(kind, targetId, universe)) throw new DeviceImportStagingError('The selected target no longer exists or is archived.')
  const meta = metadata(reference.metadata)
  if (kind === 'SITE') {
    const site = universe.sites.find((record) => record.id === targetId)!
    if (!meta.customerTargetId || site.customerId !== meta.customerTargetId) {
      throw new DeviceImportStagingError('The selected site belongs to another customer.')
    }
  }
  if (kind === 'DEVICE_MODEL') {
    const model = universe.models.find((record) => record.id === targetId)!
    if (meta.vendorTargetId && model.vendorId !== meta.vendorTargetId) throw new DeviceImportStagingError('The selected model belongs to another vendor.')
    if (meta.deviceTypeTargetId && model.deviceTypeId !== meta.deviceTypeTargetId) throw new DeviceImportStagingError('The selected model belongs to another device type.')
  }
  if (kind === 'FIRMWARE_RELEASE') {
    const release = universe.firmwareReleases.find((record) => record.id === targetId)!
    if (meta.vendorTargetId && release.vendorId !== meta.vendorTargetId) throw new DeviceImportStagingError('The selected firmware belongs to another vendor.')
    if (meta.platform && normalizedPlatform(release.platform) !== normalizedPlatform(meta.platform)) {
      throw new DeviceImportStagingError('The selected firmware is not compatible with the resolved model platform.')
    }
  }
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

export async function resolveDeviceImportStagedReference(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId : ''
  const referenceId = typeof input.referenceId === 'string' ? input.referenceId : ''
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : ''
  const remember = input.remember === true
  const created = input.created === true
  if (!batchId || !referenceId || !targetId) throw new DeviceImportStagingError('Choose a staged reference and configured target.')

  const [batch, reference] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId } }) as Promise<BatchRecord | null>,
    prisma.deviceImportStagedReference.findFirst({ where: { id: referenceId, batchId } }) as Promise<StagedReferenceRecord | null>,
  ])
  if (!batch || !reference) throw new DeviceImportStagingError('The staged import reference was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')

  const universe = await loadReferenceUniverse(batch.profileId)
  await validateOneTimeTarget(reference, targetId, universe)
  if (remember) {
    await saveImportReferenceAlias({
      profileId: batch.profileId,
      kind: reference.kind,
      sourceValue: reference.sourceValue,
      contextKey: aliasContext(reference),
      targetId,
    })
  }

  await prisma.deviceImportStagedReference.update({
    where: { id: reference.id },
    data: {
      status: 'LINKED',
      targetId,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: created ? 'CREATED' : 'USER',
    },
  })
  return refreshDeviceImportBatchReferences(batchId)
}

const PUBLISH_FIELDS = [
  'customer', 'site', 'name', 'hostname', 'serialNumber', 'vendor', 'model', 'deviceType',
  'managementAddress', 'currentFirmware', 'externalProvider', 'externalId', 'notes',
] as const satisfies readonly DeviceImportField[]

async function publicationInput(batchId: string) {
  const [batch, rows, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId } }) as Promise<BatchRecord | null>,
    prisma.deviceImportStagedRow.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } }),
    prisma.deviceImportStagedReference.findMany({ where: { batchId } }) as Promise<StagedReferenceRecord[]>,
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  const actionableReferences = references.filter((reference) => reference.kind !== 'CONTRACT_TYPE')
  if (actionableReferences.some((reference) => reference.status !== 'LINKED')) {
    throw new DeviceImportStagingError('Resolve all staged reference values before validating devices.')
  }

  const universe = await loadReferenceUniverse(batch.profileId)
  const resolutions: Record<string, string> = {}
  for (const reference of actionableReferences) {
    if (!reference.targetId) continue
    resolutions[importResolutionKey(reference.kind as DeviceImportReferenceKind, reference.sourceValue, aliasContext(reference))] = reference.targetId
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
  const headerValues = PUBLISH_FIELDS.map((field) => field)
  const syntheticRows = [
    { rowNumber: batch.headerRow, values: headerValues },
    ...rows.map((row) => {
      const values = row.mappedData as unknown as DeviceImportMappedValues
      return { rowNumber: row.rowNumber, values: PUBLISH_FIELDS.map((field) => values[field] ?? '') }
    }),
  ]
  const workbook: XlsxWorkbook = {
    sheets: [{ name: batch.sheetName, rowCount: batch.totalRows + batch.headerRow, columnCount: PUBLISH_FIELDS.length, rows: syntheticRows }],
  }
  return { batch, workbook, options, universe }
}

export async function validateDeviceImportBatch(batchId: string): Promise<DeviceImportPreview> {
  const { batch, workbook, options } = await publicationInput(batchId)
  return previewDeviceImport(workbook, options, batch.fileName)
}

export async function publishDeviceImportBatch(batchId: string, actorUserId: string | null): Promise<DeviceImportResult> {
  const { batch, workbook, options } = await publicationInput(batchId)
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
    prisma.deviceImportStagedRow.updateMany({ where: { batchId }, data: { status: 'PUBLISHED' } }),
    prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ])
  return result
}
