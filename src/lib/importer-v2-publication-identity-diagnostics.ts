import { prisma } from '@/lib/prisma'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import { normalizeImporterV2Identity } from '@/lib/importer-v2-identity'
import {
  importerV2PublicationIdentityFields,
  importerV2TopologyFromDecisions,
} from '@/lib/importer-v2-stack-topology'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

type CanonicalTarget = { id?: string | null; label?: string } | null

type EffectiveSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
}

type IdentityField = 'sourceId' | 'serialNumber' | 'macAddress'
type MatchingIdentifier = { field: IdentityField; value: string }

type StagedIdentityRow = {
  rowNumber: number
  sourceName: string | null
  hostname: string | null
  customer: string | null
  organizationUnit: string | null
  site: string | null
  vendor: string | null
  model: string | null
  selectedCanonicalDeviceId: string | null
  sourceIdentifiers: {
    sourceId: string | null
    serialNumber: string | null
    macAddress: string | null
  }
  normalized: ReturnType<typeof normalizeImporterV2Identity>
}

export type ImporterV2IdentityConflictDiagnostic = {
  rowNumber: number
  sourceName: string | null
  hostname: string | null
  selectedCanonicalDeviceId: string | null
  sourceIdentifiers: {
    sourceId: string | null
    serialNumber: string | null
    macAddress: string | null
  }
  conflicts: Array<{
    canonicalDeviceId: string
    name: string | null
    hostname: string | null
    serialNumber: string | null
    customer: string | null
    site: string | null
    organizationUnit: string | null
    vendor: string | null
    model: string | null
    matchingIdentifiers: MatchingIdentifier[]
  }>
  stagedConflicts: Array<{
    rowNumber: number
    sourceName: string | null
    hostname: string | null
    customer: string | null
    organizationUnit: string | null
    site: string | null
    vendor: string | null
    model: string | null
    selectedCanonicalDeviceId: string | null
    matchingIdentifiers: MatchingIdentifier[]
  }>
}

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function effectiveText(snapshot: EffectiveSnapshot, field: ImporterV2Field) {
  return (
    clean(snapshot.proposedCanonicalValues?.[field]?.label) ??
    clean(snapshot.rawValues?.[field])
  )
}

function chosenDeviceId(input: {
  identityResolution: unknown
  decisions: readonly {
    action: string
    field: string | null
    value: unknown
  }[]
}) {
  const review = importerV2WorkspaceIdentityReview(input)
  if (!review) return null
  if (review.selectedDecision === 'CREATE_NEW') return null
  if (review.selectedCanonicalDeviceId) return review.selectedCanonicalDeviceId
  if (!review.requiresConfirmation && review.candidates.length === 1) {
    return review.candidates[0].canonicalDeviceId
  }
  return null
}

function identityValue(row: StagedIdentityRow, field: IdentityField) {
  switch (field) {
    case 'sourceId':
      return row.sourceIdentifiers.sourceId
    case 'serialNumber':
      return row.sourceIdentifiers.serialNumber
    case 'macAddress':
      return row.sourceIdentifiers.macAddress
  }
}

export function findImporterV2StagedIdentityCollisions(rows: readonly StagedIdentityRow[]) {
  const buckets = new Map<string, StagedIdentityRow[]>()
  const definitions: Array<[IdentityField, keyof StagedIdentityRow['normalized']]> = [
    ['sourceId', 'sourceId'],
    ['serialNumber', 'serialNumber'],
    ['macAddress', 'macAddress'],
  ]

  for (const row of rows) {
    for (const [field, key] of definitions) {
      const value = row.normalized[key]
      if (!value) continue
      const bucketKey = `${field}:${value}`
      const bucket = buckets.get(bucketKey) ?? []
      bucket.push(row)
      buckets.set(bucketKey, bucket)
    }
  }

  const byRow = new Map<number, Map<number, { row: StagedIdentityRow; matchingIdentifiers: MatchingIdentifier[] }>>()
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.length < 2) continue
    const field = bucketKey.slice(0, bucketKey.indexOf(':')) as IdentityField
    for (const row of bucket) {
      const others = byRow.get(row.rowNumber) ?? new Map()
      for (const other of bucket) {
        if (other.rowNumber === row.rowNumber) continue
        const existing = others.get(other.rowNumber) ?? {
          row: other,
          matchingIdentifiers: [],
        }
        const value = identityValue(row, field)
        if (
          value &&
          !existing.matchingIdentifiers.some(
            (match) => match.field === field && match.value === value,
          )
        ) {
          existing.matchingIdentifiers.push({ field, value })
        }
        others.set(other.rowNumber, existing)
      }
      byRow.set(row.rowNumber, others)
    }
  }

  return byRow
}

export async function findImporterV2PublicationIdentityConflicts(input: {
  batchId: string
  rowNumbers: readonly number[]
}): Promise<ImporterV2IdentityConflictDiagnostic[]> {
  if (input.rowNumbers.length === 0) return []

  const batch = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { id: input.batchId },
    select: {
      provider: true,
      rows: {
        where: {
          rowNumber: { in: [...input.rowNumbers] },
          inclusion: 'INCLUDED',
          publishedAt: null,
        },
        orderBy: { rowNumber: 'asc' },
        select: {
          rowNumber: true,
          sourceName: true,
          hostname: true,
          evaluated: true,
          identityResolution: true,
          decisions: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { action: true, field: true, value: true },
          },
        },
      },
    },
  })
  if (!batch) return []

  const rows: StagedIdentityRow[] = batch.rows.flatMap((row) => {
    const topology = importerV2TopologyFromDecisions(row.decisions)
    if (topology.role === 'STACK_MEMBER') return []

    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: 'INCLUDED',
      decisions: row.decisions,
    }).evaluated as EffectiveSnapshot
    const sourceIdentifiers = importerV2PublicationIdentityFields({
      topology,
      sourceId: effectiveText(snapshot, 'sourceId'),
      serialNumber: effectiveText(snapshot, 'serialNumber'),
      macAddress: effectiveText(snapshot, 'macAddress'),
    })
    return [{
      rowNumber: row.rowNumber,
      sourceName: row.sourceName ?? effectiveText(snapshot, 'deviceName'),
      hostname: row.hostname ?? effectiveText(snapshot, 'hostname'),
      customer: effectiveText(snapshot, 'customer'),
      organizationUnit: effectiveText(snapshot, 'businessUnit'),
      site: effectiveText(snapshot, 'site'),
      vendor: effectiveText(snapshot, 'vendor'),
      model: effectiveText(snapshot, 'model'),
      sourceIdentifiers,
      normalized: normalizeImporterV2Identity(sourceIdentifiers),
      selectedCanonicalDeviceId: chosenDeviceId({
        identityResolution: row.identityResolution,
        decisions: row.decisions,
      }),
    }]
  })

  const stagedCollisions = findImporterV2StagedIdentityCollisions(rows)
  const sourceIds = [...new Set(rows.flatMap((row) => row.normalized.sourceId ? [row.normalized.sourceId] : []))]
  const serialNumbers = [...new Set(rows.flatMap((row) => row.normalized.serialNumber ? [row.normalized.serialNumber] : []))]
  const macAddresses = [...new Set(rows.flatMap((row) => row.normalized.macAddress ? [row.normalized.macAddress] : []))]
  const OR = [
    ...(sourceIds.length ? [{ normalizedSourceId: { in: sourceIds } }] : []),
    ...(serialNumbers.length ? [{ normalizedSerialNumber: { in: serialNumbers } }] : []),
    ...(macAddresses.length ? [{ normalizedMacAddress: { in: macAddresses } }] : []),
  ]

  const crosswalks = OR.length
    ? await prisma.importerV2DeviceCrosswalk.findMany({
        where: { provider: batch.provider, OR },
        select: {
          canonicalDeviceId: true,
          normalizedSourceId: true,
          normalizedSerialNumber: true,
          normalizedMacAddress: true,
        },
      })
    : []

  const conflictingDeviceIds = new Set<string>()
  const canonicalMatchesByRow = new Map<number, Array<{
    crosswalk: (typeof crosswalks)[number]
    matchingIdentifiers: MatchingIdentifier[]
  }>>()

  for (const row of rows) {
    const matches = crosswalks
      .map((crosswalk) => {
        const matchingIdentifiers: MatchingIdentifier[] = []
        if (
          row.normalized.sourceId &&
          crosswalk.normalizedSourceId === row.normalized.sourceId
        ) {
          matchingIdentifiers.push({ field: 'sourceId', value: row.sourceIdentifiers.sourceId! })
        }
        if (
          row.normalized.serialNumber &&
          crosswalk.normalizedSerialNumber === row.normalized.serialNumber
        ) {
          matchingIdentifiers.push({ field: 'serialNumber', value: row.sourceIdentifiers.serialNumber! })
        }
        if (
          row.normalized.macAddress &&
          crosswalk.normalizedMacAddress === row.normalized.macAddress
        ) {
          matchingIdentifiers.push({ field: 'macAddress', value: row.sourceIdentifiers.macAddress! })
        }
        return { crosswalk, matchingIdentifiers }
      })
      .filter(
        ({ crosswalk, matchingIdentifiers }) =>
          matchingIdentifiers.length > 0 &&
          crosswalk.canonicalDeviceId !== row.selectedCanonicalDeviceId,
      )
    canonicalMatchesByRow.set(row.rowNumber, matches)
    for (const match of matches) conflictingDeviceIds.add(match.crosswalk.canonicalDeviceId)
  }

  const devices = conflictingDeviceIds.size
    ? await prisma.device.findMany({
        where: { id: { in: [...conflictingDeviceIds] } },
        select: {
          id: true,
          name: true,
          hostname: true,
          serialNumber: true,
          customer: { select: { name: true } },
          site: {
            select: {
              name: true,
              organizationUnit: { select: { name: true } },
            },
          },
          deviceModel: {
            select: {
              model: true,
              vendor: { select: { name: true } },
            },
          },
        },
      })
    : []
  const deviceById = new Map(devices.map((device) => [device.id, device]))

  return rows
    .map((row) => {
      const canonicalMatches = canonicalMatchesByRow.get(row.rowNumber) ?? []
      const stagedMatches = [...(stagedCollisions.get(row.rowNumber)?.values() ?? [])]
      if (canonicalMatches.length === 0 && stagedMatches.length === 0) return null
      return {
        rowNumber: row.rowNumber,
        sourceName: row.sourceName,
        hostname: row.hostname,
        selectedCanonicalDeviceId: row.selectedCanonicalDeviceId,
        sourceIdentifiers: row.sourceIdentifiers,
        conflicts: canonicalMatches.map(({ crosswalk, matchingIdentifiers }) => {
          const device = deviceById.get(crosswalk.canonicalDeviceId)
          return {
            canonicalDeviceId: crosswalk.canonicalDeviceId,
            name: device?.name ?? null,
            hostname: device?.hostname ?? null,
            serialNumber: device?.serialNumber ?? null,
            customer: device?.customer.name ?? null,
            site: device?.site?.name ?? null,
            organizationUnit: device?.site?.organizationUnit?.name ?? null,
            vendor: device?.deviceModel.vendor.name ?? null,
            model: device?.deviceModel.model ?? null,
            matchingIdentifiers,
          }
        }),
        stagedConflicts: stagedMatches.map(({ row: other, matchingIdentifiers }) => ({
          rowNumber: other.rowNumber,
          sourceName: other.sourceName,
          hostname: other.hostname,
          customer: other.customer,
          organizationUnit: other.organizationUnit,
          site: other.site,
          vendor: other.vendor,
          model: other.model,
          selectedCanonicalDeviceId: other.selectedCanonicalDeviceId,
          matchingIdentifiers,
        })),
      }
    })
    .filter((row): row is ImporterV2IdentityConflictDiagnostic => row !== null)
}

const IDENTITY_LABELS: Record<IdentityField, string> = {
  sourceId: 'Source ID',
  serialNumber: 'serial',
  macAddress: 'MAC',
}

export function formatImporterV2IdentityConflictMessage(
  conflicts: readonly ImporterV2IdentityConflictDiagnostic[],
) {
  const examples = conflicts.slice(0, 8).map((conflict) => {
    const sourceLabel = conflict.sourceName ?? conflict.hostname ?? 'unnamed staged device'
    const destinations = conflict.conflicts.slice(0, 3).map((device) => {
      const identity = device.matchingIdentifiers
        .map((match) => `${IDENTITY_LABELS[match.field]} “${match.value}”`)
        .join(' + ')
      const deviceLabel = device.name ?? device.hostname ?? device.canonicalDeviceId
      const location = [device.customer, device.organizationUnit, device.site]
        .filter(Boolean)
        .join(' / ')
      const model = [device.vendor, device.model].filter(Boolean).join(' ')
      const context = [location, model].filter(Boolean).join(' · ')
      return `${identity} already belongs to canonical device “${deviceLabel}”${context ? ` (${context})` : ''}`
    })
    const staged = conflict.stagedConflicts.slice(0, 3).map((other) => {
      const identity = other.matchingIdentifiers
        .map((match) => `${IDENTITY_LABELS[match.field]} “${match.value}”`)
        .join(' + ')
      const otherLabel = other.sourceName ?? other.hostname ?? 'unnamed staged device'
      const location = [other.customer, other.organizationUnit, other.site]
        .filter(Boolean)
        .join(' / ')
      const model = [other.vendor, other.model].filter(Boolean).join(' ')
      const context = [location, model].filter(Boolean).join(' · ')
      return `${identity} is also used by staged row #${other.rowNumber} “${otherLabel}”${context ? ` (${context})` : ''}`
    })
    const selected = conflict.selectedCanonicalDeviceId
      ? ` This row currently points to canonical device ${conflict.selectedCanonicalDeviceId}.`
      : ' This row is currently set to create a new device.'
    return `Row #${conflict.rowNumber} “${sourceLabel}”: ${[...destinations, ...staged].join('; ')}.${selected}`
  })
  const remaining = conflicts.length - examples.length
  return [
    `Durable identity conflict on ${conflicts.length} staged row(s).`,
    ...examples,
    remaining > 0 ? `${remaining} more conflicting row(s) are not shown.` : null,
    'Resolve the listed duplicate Source ID / serial / MAC in the Inspector, link the row to the correct existing device, or explicitly exclude a stale duplicate before publishing.',
  ]
    .filter(Boolean)
    .join(' ')
}
