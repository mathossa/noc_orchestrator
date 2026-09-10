import { prisma } from '@/lib/prisma'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import { normalizeImporterV2Identity } from '@/lib/importer-v2-identity'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

type CanonicalTarget = { id?: string | null; label?: string } | null

type EffectiveSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
}

type IdentityField = 'sourceId' | 'serialNumber' | 'macAddress'

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
    matchingIdentifiers: Array<{
      field: IdentityField
      value: string
    }>
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

  const rows = batch.rows.map((row) => {
    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: 'INCLUDED',
      decisions: row.decisions,
    }).evaluated as EffectiveSnapshot
    const sourceIdentifiers = {
      sourceId: effectiveText(snapshot, 'sourceId'),
      serialNumber: effectiveText(snapshot, 'serialNumber'),
      macAddress: effectiveText(snapshot, 'macAddress'),
    }
    return {
      row,
      sourceIdentifiers,
      normalized: normalizeImporterV2Identity(sourceIdentifiers),
      selectedCanonicalDeviceId: chosenDeviceId({
        identityResolution: row.identityResolution,
        decisions: row.decisions,
      }),
    }
  })

  const sourceIds = [...new Set(rows.flatMap((row) => row.normalized.sourceId ? [row.normalized.sourceId] : []))]
  const serialNumbers = [...new Set(rows.flatMap((row) => row.normalized.serialNumber ? [row.normalized.serialNumber] : []))]
  const macAddresses = [...new Set(rows.flatMap((row) => row.normalized.macAddress ? [row.normalized.macAddress] : []))]
  const OR = [
    ...(sourceIds.length ? [{ normalizedSourceId: { in: sourceIds } }] : []),
    ...(serialNumbers.length ? [{ normalizedSerialNumber: { in: serialNumbers } }] : []),
    ...(macAddresses.length ? [{ normalizedMacAddress: { in: macAddresses } }] : []),
  ]
  if (OR.length === 0) return []

  const crosswalks = await prisma.importerV2DeviceCrosswalk.findMany({
    where: { provider: batch.provider, OR },
    select: {
      canonicalDeviceId: true,
      normalizedSourceId: true,
      normalizedSerialNumber: true,
      normalizedMacAddress: true,
    },
  })
  const conflictingDeviceIds = new Set<string>()
  const rawConflicts = rows.map((row) => {
    const matches = crosswalks
      .map((crosswalk) => {
        const matchingIdentifiers: Array<{ field: IdentityField; value: string }> = []
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

    for (const match of matches) conflictingDeviceIds.add(match.crosswalk.canonicalDeviceId)
    return { ...row, matches }
  })

  if (conflictingDeviceIds.size === 0) return []
  const devices = await prisma.device.findMany({
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
  const deviceById = new Map(devices.map((device) => [device.id, device]))

  return rawConflicts
    .filter((row) => row.matches.length > 0)
    .map((row) => ({
      rowNumber: row.row.rowNumber,
      sourceName: row.row.sourceName,
      hostname: row.row.hostname,
      selectedCanonicalDeviceId: row.selectedCanonicalDeviceId,
      sourceIdentifiers: row.sourceIdentifiers,
      conflicts: row.matches.map(({ crosswalk, matchingIdentifiers }) => {
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
    }))
}

const IDENTITY_LABELS: Record<IdentityField, string> = {
  sourceId: 'Source ID',
  serialNumber: 'serial',
  macAddress: 'MAC',
}

export function formatImporterV2IdentityConflictMessage(
  conflicts: readonly ImporterV2IdentityConflictDiagnostic[],
) {
  const examples = conflicts.slice(0, 4).map((conflict) => {
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
      return `${identity} already belongs to “${deviceLabel}”${context ? ` (${context})` : ''}`
    })
    const selected = conflict.selectedCanonicalDeviceId
      ? ` The staged row currently points to canonical device ${conflict.selectedCanonicalDeviceId}.`
      : ' The staged row is currently set to create a new device.'
    return `Row #${conflict.rowNumber} “${sourceLabel}”: ${destinations.join('; ')}.${selected}`
  })
  const remaining = conflicts.length - examples.length
  return [
    `Durable source identity conflict on ${conflicts.length} staged row(s).`,
    ...examples,
    remaining > 0 ? `${remaining} more conflicting row(s) are not shown.` : null,
    'Open the listed row(s) in the Inspector and choose the existing device or correct the Source ID / serial / MAC before publishing.',
  ]
    .filter(Boolean)
    .join(' ')
}
