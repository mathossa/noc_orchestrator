import { normalizeImportText, parseDeviceImportOptions } from '@/lib/device-import'
import {
  buildDeviceImportStagedReferenceSeeds,
  type DeviceImportMappedValues,
} from '@/lib/device-import-staging'
import {
  DeviceImportStagingError,
  getDeviceImportBatchWorkspace,
  refreshDeviceImportBatchReferences,
} from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

export const IMPORT_RULE_FIELDS = ['customer', 'site', 'vendor', 'deviceType', 'model', 'currentFirmware', 'name', 'hostname', 'externalId'] as const
export type ImportRuleField = (typeof IMPORT_RULE_FIELDS)[number]

const REBUILD_CHUNK = 500

type StagedReferenceSnapshot = {
  kind: string
  normalizedSourceValue: string
  contextKey: string
  status: string
  targetId: string | null
  suggestedTargetId: string | null
  suggestionScore: number | null
  resolutionSource: string | null
  metadata: unknown
}

function cleanField(value: unknown): ImportRuleField | null {
  return typeof value === 'string' && IMPORT_RULE_FIELDS.includes(value as ImportRuleField)
    ? value as ImportRuleField
    : null
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function mappedData(value: unknown): DeviceImportMappedValues {
  return (typeof value === 'object' && value !== null ? value : {}) as DeviceImportMappedValues
}

function rowMatches(field: ImportRuleField, rawValue: string, data: DeviceImportMappedValues) {
  return normalizeImportText(data[field]) === normalizeImportText(rawValue)
}

async function rebuildActiveReferences(batchId: string) {
  const [batch, rows, previous] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, settings: true, status: true } }),
    prisma.deviceImportStagedRow.findMany({
      where: { batchId, status: 'STAGED' },
      orderBy: { rowNumber: 'asc' },
      select: { rowNumber: true, mappedData: true },
    }),
    prisma.deviceImportStagedReference.findMany({
      where: { batchId },
      select: {
        kind: true,
        normalizedSourceValue: true,
        contextKey: true,
        status: true,
        targetId: true,
        suggestedTargetId: true,
        suggestionScore: true,
        resolutionSource: true,
        metadata: true,
      },
    }) as Promise<StagedReferenceSnapshot[]>,
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')

  const options = parseDeviceImportOptions(batch.settings)
  const seeds = buildDeviceImportStagedReferenceSeeds(
    rows.map((row) => ({ rowNumber: row.rowNumber, values: mappedData(row.mappedData) })),
    options,
  )
  const previousByKey = new Map(previous.map((reference) => [
    `${reference.kind}|${reference.contextKey}|${reference.normalizedSourceValue}`,
    reference,
  ]))

  await prisma.$transaction(async (tx) => {
    await tx.deviceImportStagedReference.deleteMany({ where: { batchId } })
    const next = seeds.map((seed) => {
      const old = previousByKey.get(`${seed.kind}|${seed.contextKey}|${seed.normalizedSourceValue}`)
      const preserve = old?.status === 'LINKED' && old.targetId
      return {
        batchId,
        kind: seed.kind,
        sourceValue: seed.sourceValue,
        normalizedSourceValue: seed.normalizedSourceValue,
        contextKey: seed.contextKey,
        metadata: seed.metadata,
        occurrenceCount: seed.occurrenceCount,
        status: preserve ? 'LINKED' : 'UNRESOLVED',
        targetId: preserve ? old.targetId : null,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: preserve ? old.resolutionSource : null,
      }
    })
    for (const part of chunks(next, REBUILD_CHUNK)) await tx.deviceImportStagedReference.createMany({ data: part })
  })

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
      select: { id: true, mappedData: true },
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
  await prisma.$transaction([...matched.entries()].map(([id, match]) => prisma.deviceImportStagedRow.update({
    where: { id },
    data: {
      status: 'IGNORED',
      statusSource: 'PROFILE_RULE',
      statusReason: `${match.field} = ${match.value}`,
    },
  })))
  return rebuildActiveReferences(batchId)
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

  await prisma.$transaction(selected.map((row) => prisma.deviceImportStagedRow.update({
    where: { id: row.id },
    data: action === 'RESTORE'
      ? { status: 'STAGED', statusSource: null, statusReason: null }
      : {
          status: action === 'IGNORE' ? 'IGNORED' : 'EXCLUDED',
          statusSource: remember ? 'PROFILE_RULE' : 'USER',
          statusReason: field && value ? `${field} = ${value}` : 'Selected rows',
        },
  })))

  const workspace = await rebuildActiveReferences(batchId)
  return { affected: selected.length, workspace, smartGroups: await getDeviceImportSmartGroups(batchId) }
}

export async function listDeviceImportProfileRules(profileId: string) {
  return prisma.deviceImportProfileRule.findMany({
    where: { profileId, isActive: true },
    orderBy: [{ field: 'asc' }, { value: 'asc' }],
    select: { id: true, action: true, field: true, operator: true, value: true, normalizedValue: true, isActive: true },
  })
}
