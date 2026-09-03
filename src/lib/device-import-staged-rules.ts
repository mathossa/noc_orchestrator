import { normalizeImportText, parseDeviceImportOptions } from '@/lib/device-import'
import {
  buildDeviceImportStagedReferenceSeeds,
  type DeviceImportMappedValues,
  type DeviceImportStagedReferenceMetadata,
} from '@/lib/device-import-staging'
import {
  DeviceImportStagingError,
  getDeviceImportBatchWorkspace,
  refreshDeviceImportBatchReferences,
} from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

export const IMPORT_RULE_FIELDS = ['customer', 'site', 'vendor', 'deviceType', 'model', 'currentFirmware', 'name', 'hostname', 'externalId'] as const
export type ImportRuleField = (typeof IMPORT_RULE_FIELDS)[number]

function cleanField(value: unknown): ImportRuleField | null {
  return typeof value === 'string' && IMPORT_RULE_FIELDS.includes(value as ImportRuleField)
    ? value as ImportRuleField
    : null
}

function mappedData(value: unknown): DeviceImportMappedValues {
  return (typeof value === 'object' && value !== null ? value : {}) as DeviceImportMappedValues
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return (typeof value === 'object' && value !== null ? value : {}) as DeviceImportStagedReferenceMetadata
}

function rowMatches(field: ImportRuleField, rawValue: string, data: DeviceImportMappedValues) {
  return normalizeImportText(data[field]) === normalizeImportText(rawValue)
}

function referenceKey(reference: { kind: string; contextKey: string; normalizedSourceValue: string }) {
  return `${reference.kind}|${reference.contextKey}|${reference.normalizedSourceValue}`
}

export async function refreshAffectedReferences(batchId: string, changes: Array<{ rowNumber: number; mappedData: unknown; delta: -1 | 1 }>) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, settings: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')

  const options = parseDeviceImportOptions(batch.settings)
  const deltas = new Map<string, { seed: ReturnType<typeof buildDeviceImportStagedReferenceSeeds>[number]; count: number; addedRows: number[]; removedRows: number[] }>()
  for (const delta of [-1, 1] as const) {
    const deltaRows = changes.filter((change) => change.delta === delta)
    if (!deltaRows.length) continue
    const seeds = buildDeviceImportStagedReferenceSeeds(deltaRows.map((change) => ({ rowNumber: change.rowNumber, values: mappedData(change.mappedData) })), options)
    for (const seed of seeds) {
      const key = referenceKey(seed)
      const current = deltas.get(key) ?? { seed, count: 0, addedRows: [], removedRows: [] }
      current.count += delta * seed.occurrenceCount
      ;(delta > 0 ? current.addedRows : current.removedRows).push(...(seed.metadata.rowNumbers ?? []))
      deltas.set(key, current)
    }
  }
  if (!deltas.size) return refreshDeviceImportBatchReferences(batchId)
  const keys = [...deltas.values()].map(({ seed }) => ({ kind: seed.kind, contextKey: seed.contextKey, normalizedSourceValue: seed.normalizedSourceValue }))
  const existing = await prisma.deviceImportStagedReference.findMany({ where: { batchId, OR: keys }, select: { id: true, kind: true, contextKey: true, normalizedSourceValue: true, occurrenceCount: true, metadata: true } })
  const existingByKey = new Map(existing.map((reference) => [referenceKey(reference), reference]))
  const operations = [...deltas].flatMap(([key, change]) => {
    const current = existingByKey.get(key)
    const occurrenceCount = (current?.occurrenceCount ?? 0) + change.count
    if (occurrenceCount <= 0) return current ? [prisma.deviceImportStagedReference.delete({ where: { id: current.id } })] : []
    const oldMetadata = metadata(current?.metadata)
    const rowNumbers = [...new Set([...(oldMetadata.rowNumbers ?? []).filter((row) => !change.removedRows.includes(row)), ...change.addedRows])].slice(0, 20)
    const nextMetadata: DeviceImportStagedReferenceMetadata = { ...oldMetadata, rowNumbers }
    if (change.addedRows.length) {
      const platforms = [...new Map([...(oldMetadata.platforms ?? []), ...(change.seed.metadata.platforms ?? [])].map((value) => [normalizeImportText(value), value])).values()].filter(Boolean)
      if (platforms.length) {
        nextMetadata.platforms = platforms
        nextMetadata.platform = platforms.length === 1 ? platforms[0] : null
      }
      const deviceTypes = [...new Map([...(oldMetadata.deviceTypeSourceValues ?? []), ...(change.seed.metadata.deviceTypeSourceValues ?? [])].map((value) => [normalizeImportText(value), value])).values()].filter(Boolean)
      if (deviceTypes.length) {
        nextMetadata.deviceTypeSourceValues = deviceTypes
        nextMetadata.deviceTypeSourceValue = deviceTypes[0]
      }
      const softwareVersions = [...new Map([...(oldMetadata.softwareVersionSourceValues ?? []), ...(change.seed.metadata.softwareVersionSourceValues ?? [])].map((value) => [normalizeImportText(value), value])).values()].filter(Boolean)
      if (softwareVersions.length) {
        nextMetadata.softwareVersionSourceValues = softwareVersions
        nextMetadata.softwareVersionSourceValue = softwareVersions[0]
      }
    }
    if (current) return [prisma.deviceImportStagedReference.update({ where: { id: current.id }, data: { occurrenceCount, metadata: nextMetadata } })]
    return [prisma.deviceImportStagedReference.create({ data: { batchId, kind: change.seed.kind, sourceValue: change.seed.sourceValue, normalizedSourceValue: change.seed.normalizedSourceValue, contextKey: change.seed.contextKey, metadata: change.seed.metadata, occurrenceCount, status: 'UNRESOLVED' } })]
  })
  if (operations.length) await prisma.$transaction(operations)

  return refreshDeviceImportBatchReferences(batchId)
}

export async function applySavedImportProfileRules(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, profileId: true, status: true },
  })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (!batch.profileId || batch.status === 'PUBLISHED') return getDeviceImportBatchWorkspace(batchId)

  const [rules, rows] = await Promise.all([
    prisma.deviceImportProfileRule.findMany({
      where: { profileId: batch.profileId, isActive: true, action: 'IGNORE', operator: 'EQUALS' },
      select: { id: true, field: true, value: true },
    }),
    prisma.deviceImportStagedRow.findMany({
      where: { batchId, status: 'STAGED' },
      select: { id: true, rowNumber: true, mappedData: true },
    }),
  ])

  const matched = new Map<string, { ruleId: string; field: string; value: string }>()
  for (const rule of rules) {
    const field = cleanField(rule.field)
    if (!field) continue
    for (const row of rows) {
      if (rowMatches(field, rule.value, mappedData(row.mappedData))) {
        matched.set(row.id, { ruleId: rule.id, field, value: rule.value })
      }
    }
  }

  if (!matched.size) return getDeviceImportBatchWorkspace(batchId)
  const groupedMatches = new Map<string, { ids: string[]; reason: string }>()
  for (const [id, match] of matched) {
    const reason = `${match.field} = ${match.value}`
    const current = groupedMatches.get(reason) ?? { ids: [], reason }
    current.ids.push(id)
    groupedMatches.set(reason, current)
  }
  await prisma.$transaction([...groupedMatches.values()].map((group) => prisma.deviceImportStagedRow.updateMany({
    where: { id: { in: group.ids } },
    data: {
      status: 'IGNORED',
      statusSource: 'PROFILE_RULE',
      statusReason: group.reason,
    },
  })))
  return refreshAffectedReferences(batchId, rows.filter((row) => matched.has(row.id)).map((row) => ({ ...row, delta: -1 as const })))
}

export async function getDeviceImportSmartGroups(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, profileId: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  const rows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId, status: 'STAGED' },
    select: { rowNumber: true, mappedData: true },
  })

  const fields: ImportRuleField[] = ['customer', 'site', 'vendor', 'deviceType', 'model', 'currentFirmware']
  const groups = fields.flatMap((field) => {
    const byValue = new Map<string, { value: string; count: number; sampleRows: number[] }>()
    for (const row of rows) {
      const value = mappedData(row.mappedData)[field]
      const normalized = normalizeImportText(value)
      if (!normalized || !value) continue
      const current = byValue.get(normalized) ?? { value, count: 0, sampleRows: [] }
      current.count += 1
      if (current.sampleRows.length < 5) current.sampleRows.push(row.rowNumber)
      byValue.set(normalized, current)
    }
    return [...byValue.values()]
      .filter((group) => group.count >= 2)
      .map((group) => ({ field, ...group }))
  }).sort((left, right) => right.count - left.count || left.field.localeCompare(right.field) || left.value.localeCompare(right.value))

  const counts = await prisma.deviceImportStagedRow.groupBy({
    by: ['status'],
    where: { batchId },
    _count: { _all: true },
  })
  return {
    profileId: batch.profileId,
    groups,
    rowCounts: Object.fromEntries(counts.map((entry) => [entry.status, entry._count._all])),
  }
}

export async function applyDeviceImportRowAction(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const action = input.action === 'IGNORE' ? 'IGNORE' : input.action === 'EXCLUDE' ? 'EXCLUDE' : input.action === 'RESTORE' ? 'RESTORE' : null
  const field = cleanField(input.field)
  const value = typeof input.value === 'string' ? input.value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
  const rowNumbers = Array.isArray(input.rowNumbers)
    ? [...new Set(input.rowNumbers.map(Number).filter((number) => Number.isInteger(number) && number > 0))]
    : []
  const remember = input.remember === true
  if (!batchId || !action) throw new DeviceImportStagingError('Choose a valid staged-row action.')
  if (!rowNumbers.length && (!field || !value)) throw new DeviceImportStagingError('Choose rows or a group value to update.')
  if (remember && (action !== 'IGNORE' || !field || !value)) {
    throw new DeviceImportStagingError('Only a named group can be remembered as an import-profile ignore rule.')
  }

  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, profileId: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')

  const rows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId },
    select: { id: true, rowNumber: true, status: true, mappedData: true },
  })
  const selected = rows.filter((row) => rowNumbers.includes(row.rowNumber) || (field && value && rowMatches(field, value, mappedData(row.mappedData))))
  if (!selected.length) throw new DeviceImportStagingError('No staged rows match the requested action.')

  if (remember) {
    if (!batch.profileId) throw new DeviceImportStagingError('Choose an import profile before remembering an ignore rule.')
    await prisma.deviceImportProfileRule.upsert({
      where: {
        profileId_action_field_operator_normalizedValue: {
          profileId: batch.profileId,
          action: 'IGNORE',
          field: field!,
          operator: 'EQUALS',
          normalizedValue: normalizeImportText(value),
        },
      },
      update: { value, isActive: true },
      create: {
        profileId: batch.profileId,
        action: 'IGNORE',
        field: field!,
        operator: 'EQUALS',
        value,
        normalizedValue: normalizeImportText(value),
      },
    })
  }

  await prisma.deviceImportStagedRow.updateMany({
    where: { id: { in: selected.map((row) => row.id) } },
    data: action === 'RESTORE'
      ? { status: 'STAGED', statusSource: null, statusReason: null }
      : {
          status: action === 'IGNORE' ? 'IGNORED' : 'EXCLUDED',
          statusSource: remember ? 'PROFILE_RULE' : 'USER',
          statusReason: field && value ? `${field} = ${value}` : 'Selected rows',
        },
  })

  const nextActive = action === 'RESTORE'
  const changed = selected.flatMap((row) => {
    const currentActive = row.status === 'STAGED'
    return currentActive === nextActive ? [] : [{ ...row, delta: (nextActive ? 1 : -1) as -1 | 1 }]
  })
  const workspace = await refreshAffectedReferences(batchId, changed)
  return { affected: selected.length, workspace }
}

export async function listDeviceImportProfileRules(profileId: string) {
  return prisma.deviceImportProfileRule.findMany({
    where: { profileId, isActive: true },
    orderBy: [{ field: 'asc' }, { value: 'asc' }],
    select: { id: true, action: true, field: true, operator: true, value: true, normalizedValue: true, isActive: true },
  })
}
