import { prisma } from '@/lib/prisma'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import {
  normalizeImporterV2Identity,
  type ImporterV2IdentityCandidate,
  type ImporterV2IdentityIdentifiers,
} from '@/lib/importer-v2-identity'
import type { ImporterV2RepeatSnapshotRow } from '@/lib/importer-v2-repeat-diff'

export type ImporterV2SuccessfulPublicationRow = {
  rowNumber: number
  canonicalDeviceId: string | null
  sourceRecordKey?: string | null
  rowFingerprint: string
  identifiers: ImporterV2IdentityIdentifiers
  values: Partial<Record<ImporterV2Field, string | null>>
}

export type ImporterV2SuccessfulPublicationInput = {
  provider: string
  sourceAdapterId: string
  profileVersion: string
  evaluationFingerprint: string
  isFullInventoryExport: boolean
  publishedAt?: Date
  rows: readonly ImporterV2SuccessfulPublicationRow[]
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function rawIdentityValues(identifiers: ImporterV2IdentityIdentifiers) {
  return {
    sourceId: identifiers.sourceId ?? null,
    serialNumber: identifiers.serialNumber ?? null,
    macAddress: identifiers.macAddress ?? null,
  }
}

export async function findImporterV2IdentityCandidates(input: {
  provider: string
  sourceAdapterId: string
  identifiers: ImporterV2IdentityIdentifiers
}): Promise<ImporterV2IdentityCandidate[]> {
  const normalized = normalizeImporterV2Identity(input.identifiers)
  const OR: Record<string, string>[] = []
  if (normalized.sourceId) OR.push({ normalizedSourceId: normalized.sourceId })
  if (normalized.serialNumber) {
    OR.push({ normalizedSerialNumber: normalized.serialNumber })
  }
  if (normalized.macAddress) OR.push({ normalizedMacAddress: normalized.macAddress })
  if (OR.length === 0) return []

  const records = await prisma.importerV2DeviceCrosswalk.findMany({
    where: {
      provider: input.provider,
      sourceAdapterId: input.sourceAdapterId,
      OR,
    },
    orderBy: [{ canonicalDeviceId: 'asc' }, { id: 'asc' }],
  })

  return records.map((record) => ({
    canonicalDeviceId: record.canonicalDeviceId,
    crosswalkId: record.id,
    identifiers: {
      sourceId: record.sourceId,
      serialNumber: record.serialNumber,
      macAddress: record.macAddress,
    },
  }))
}

export async function getLatestSuccessfulImporterV2SourceSnapshot(input: {
  provider: string
  sourceAdapterId: string
}) {
  const snapshot = await prisma.importerV2SourceSnapshot.findFirst({
    where: {
      provider: input.provider,
      sourceAdapterId: input.sourceAdapterId,
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    include: { rows: { orderBy: { rowNumber: 'asc' } } },
  })
  if (!snapshot) return null

  const rows: ImporterV2RepeatSnapshotRow[] = snapshot.rows.map((row) => ({
    rowNumber: row.rowNumber,
    canonicalDeviceId: row.canonicalDeviceId,
    identifiers: {
      sourceId: row.sourceId,
      serialNumber: row.serialNumber,
      macAddress: row.macAddress,
    },
    values: row.values as Partial<Record<ImporterV2Field, string | null>>,
  }))

  return {
    id: snapshot.id,
    provider: snapshot.provider,
    sourceAdapterId: snapshot.sourceAdapterId,
    profileVersion: snapshot.profileVersion,
    evaluationFingerprint: snapshot.evaluationFingerprint,
    isFullInventoryExport: snapshot.isFullInventoryExport,
    publishedAt: snapshot.publishedAt,
    rows,
  }
}

export async function recordSuccessfulImporterV2Publication(
  input: ImporterV2SuccessfulPublicationInput,
) {
  const publishedAt = input.publishedAt ?? new Date()

  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.importerV2SourceSnapshot.create({
      data: {
        provider: input.provider,
        sourceAdapterId: input.sourceAdapterId,
        profileVersion: input.profileVersion,
        evaluationFingerprint: input.evaluationFingerprint,
        isFullInventoryExport: input.isFullInventoryExport,
        publishedAt,
      },
      select: { id: true },
    })

    if (input.rows.length > 0) {
      await tx.importerV2SourceSnapshotRow.createMany({
        data: input.rows.map((row) => {
          const normalized = normalizeImporterV2Identity(row.identifiers)
          return {
            snapshotId: snapshot.id,
            rowNumber: row.rowNumber,
            canonicalDeviceId: row.canonicalDeviceId,
            sourceRecordKey: row.sourceRecordKey ?? null,
            rowFingerprint: row.rowFingerprint,
            ...rawIdentityValues(row.identifiers),
            normalizedSourceId: normalized.sourceId,
            normalizedSerialNumber: normalized.serialNumber,
            normalizedMacAddress: normalized.macAddress,
            values: jsonValue(row.values),
          }
        }),
      })
    }

    let crosswalksPersisted = 0
    for (const row of input.rows) {
      if (!row.canonicalDeviceId) continue
      const normalized = normalizeImporterV2Identity(row.identifiers)
      if (!Object.values(normalized).some(Boolean)) continue
      const raw = rawIdentityValues(row.identifiers)

      await tx.importerV2DeviceCrosswalk.upsert({
        where: {
          provider_sourceAdapterId_canonicalDeviceId: {
            provider: input.provider,
            sourceAdapterId: input.sourceAdapterId,
            canonicalDeviceId: row.canonicalDeviceId,
          },
        },
        create: {
          provider: input.provider,
          sourceAdapterId: input.sourceAdapterId,
          canonicalDeviceId: row.canonicalDeviceId,
          ...raw,
          normalizedSourceId: normalized.sourceId,
          normalizedSerialNumber: normalized.serialNumber,
          normalizedMacAddress: normalized.macAddress,
          confirmedAt: publishedAt,
          lastSeenAt: publishedAt,
        },
        update: {
          ...raw,
          normalizedSourceId: normalized.sourceId,
          normalizedSerialNumber: normalized.serialNumber,
          normalizedMacAddress: normalized.macAddress,
          confirmedAt: publishedAt,
          lastSeenAt: publishedAt,
        },
      })
      crosswalksPersisted += 1
    }

    return { snapshotId: snapshot.id, crosswalksPersisted }
  })
}
