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

type IdentityCandidateDevice = {
  id: string
  name: string
  hostname: string | null
  serialNumber: string | null
  customer: { name: string }
  site: {
    name: string
    organizationUnit: { name: string } | null
  } | null
  deviceModel: {
    model: string
    platform: string | null
    vendor: { name: string }
    deviceType: { name: string }
    family: { name: string } | null
  }
}

type IdentityCandidateCrosswalk = {
  id: string
  provider: string
  canonicalDeviceId: string
  sourceId: string | null
  normalizedSourceId: string | null
  serialNumber: string | null
  normalizedSerialNumber: string | null
  macAddress: string | null
  normalizedMacAddress: string | null
  rawSourceId: string | null
  rawSerialNumber: string | null
  rawMacAddress: string | null
  sourceIdEvidenceState: string | null
  serialNumberEvidenceState: string | null
  macAddressEvidenceState: string | null
  lastSeenAt: Date
}

const IDENTITY_LOOKUP_CHUNK_SIZE = 4000

function chunks<T>(items: readonly T[], size = IDENTITY_LOOKUP_CHUNK_SIZE) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

const identityCrosswalkSelect = {
  id: true,
  provider: true,
  canonicalDeviceId: true,
  sourceId: true,
  normalizedSourceId: true,
  serialNumber: true,
  normalizedSerialNumber: true,
  macAddress: true,
  normalizedMacAddress: true,
  rawSourceId: true,
  rawSerialNumber: true,
  rawMacAddress: true,
  sourceIdEvidenceState: true,
  serialNumberEvidenceState: true,
  macAddressEvidenceState: true,
  lastSeenAt: true,
} as const

const identityDeviceSelect = {
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
      platform: true,
      vendor: { select: { name: true } },
      deviceType: { select: { name: true } },
      family: { select: { name: true } },
    },
  },
} as const

function candidateContext(device: IdentityCandidateDevice | undefined) {
  if (!device) return undefined
  return {
    deviceName: device.name,
    hostname: device.hostname,
    customer: device.customer.name,
    businessUnit: device.site?.organizationUnit?.name ?? null,
    site: device.site?.name ?? null,
    vendor: device.deviceModel.vendor.name,
    productFamily: device.deviceModel.family?.name ?? null,
    deviceType: device.deviceModel.deviceType.name,
    model: device.deviceModel.model,
    softwarePlatform: device.deviceModel.platform,
  }
}

function addCandidateIndex(
  map: Map<string, Set<string>>,
  key: string | null,
  canonicalDeviceId: string,
) {
  if (!key) return
  const ids = map.get(key) ?? new Set<string>()
  ids.add(canonicalDeviceId)
  map.set(key, ids)
}

function matchingCrosswalkIdentifier(
  crosswalks: readonly IdentityCandidateCrosswalk[],
  field: 'normalizedSerialNumber' | 'normalizedMacAddress',
  value: string | null,
) {
  return Boolean(
    value &&
      crosswalks.some((crosswalk) => crosswalk[field] === value),
  )
}

function hasConflictingCrossProviderEvidence(input: {
  normalized: ReturnType<typeof normalizeImporterV2Identity>
  device: IdentityCandidateDevice | undefined
  crosswalks: readonly IdentityCandidateCrosswalk[]
}) {
  const canonicalSerial = normalizeImporterV2Identity({
    serialNumber: input.device?.serialNumber ?? null,
  }).serialNumber
  const serialEvidence = new Set(
    [
      canonicalSerial,
      ...input.crosswalks.map((crosswalk) => crosswalk.normalizedSerialNumber),
    ].filter((value): value is string => Boolean(value)),
  )
  const macEvidence = new Set(
    input.crosswalks
      .map((crosswalk) => crosswalk.normalizedMacAddress)
      .filter((value): value is string => Boolean(value)),
  )

  return Boolean(
    (input.normalized.serialNumber &&
      [...serialEvidence].some(
        (value) => value !== input.normalized.serialNumber,
      )) ||
      (input.normalized.macAddress &&
        [...macEvidence].some((value) => value !== input.normalized.macAddress)),
  )
}

/**
 * Build one batch-scoped candidate resolver. Provider-local Source IDs are
 * queried only inside the incoming provider namespace. Serial/MAC aliases may
 * discover canonical devices across providers, and canonical serials are
 * preloaded once for the batch so candidate discovery never becomes N+1.
 */
export async function buildImporterV2IdentityCandidateResolver(input: {
  provider: string
  identifiers: readonly ImporterV2IdentityIdentifiers[]
}): Promise<(identifiers: ImporterV2IdentityIdentifiers) => ImporterV2IdentityCandidate[]> {
  const normalizedRows = input.identifiers.map(normalizeImporterV2Identity)
  const sourceIds = [
    ...new Set(
      normalizedRows.flatMap((row) => (row.sourceId ? [row.sourceId] : [])),
    ),
  ]
  const serialNumbers = [
    ...new Set(
      normalizedRows.flatMap((row) =>
        row.serialNumber ? [row.serialNumber] : [],
      ),
    ),
  ]
  const macAddresses = [
    ...new Set(
      normalizedRows.flatMap((row) => (row.macAddress ? [row.macAddress] : [])),
    ),
  ]

  const matchingCrosswalksById = new Map<string, IdentityCandidateCrosswalk>()
  const maxLookupSize = Math.max(
    sourceIds.length,
    serialNumbers.length,
    macAddresses.length,
  )
  for (let offset = 0; offset < maxLookupSize; offset += IDENTITY_LOOKUP_CHUNK_SIZE) {
    const sourceIdPart = sourceIds.slice(offset, offset + IDENTITY_LOOKUP_CHUNK_SIZE)
    const serialPart = serialNumbers.slice(offset, offset + IDENTITY_LOOKUP_CHUNK_SIZE)
    const macPart = macAddresses.slice(offset, offset + IDENTITY_LOOKUP_CHUNK_SIZE)
    const OR = [
      ...(sourceIdPart.length
        ? [
            {
              provider: input.provider,
              normalizedSourceId: { in: sourceIdPart },
            },
          ]
        : []),
      ...(serialPart.length
        ? [{ normalizedSerialNumber: { in: serialPart } }]
        : []),
      ...(macPart.length
        ? [{ normalizedMacAddress: { in: macPart } }]
        : []),
    ]
    if (OR.length === 0) continue
    const records = await prisma.importerV2DeviceCrosswalk.findMany({
      where: { OR },
      orderBy: [{ canonicalDeviceId: 'asc' }, { provider: 'asc' }, { id: 'asc' }],
      select: identityCrosswalkSelect,
    })
    for (const record of records) matchingCrosswalksById.set(record.id, record)
  }
  const matchingCrosswalks = [...matchingCrosswalksById.values()]

  const crosswalkCandidateIds = [
    ...new Set(matchingCrosswalks.map((record) => record.canonicalDeviceId)),
  ]
  // Canonical serial is intentionally part of cross-provider discovery. Load
  // serial-bearing devices once when serial evidence exists, then fetch any
  // source-ID/MAC-only candidate contexts by ID in bounded chunks.
  const devicesById = new Map<string, IdentityCandidateDevice>()
  if (serialNumbers.length > 0) {
    const serialDevices: IdentityCandidateDevice[] = await prisma.device.findMany({
      where: { serialNumber: { not: null } },
      select: identityDeviceSelect,
    })
    for (const device of serialDevices) devicesById.set(device.id, device)
  }
  const missingContextIds = crosswalkCandidateIds.filter(
    (id) => !devicesById.has(id),
  )
  for (const part of chunks(missingContextIds)) {
    const contextDevices: IdentityCandidateDevice[] = await prisma.device.findMany({
      where: { id: { in: part } },
      select: identityDeviceSelect,
    })
    for (const device of contextDevices) devicesById.set(device.id, device)
  }
  const devices = [...devicesById.values()]
  const canonicalSerials = new Map<string, Set<string>>()
  for (const device of devices) {
    const serial = normalizeImporterV2Identity({
      serialNumber: device.serialNumber,
    }).serialNumber
    addCandidateIndex(canonicalSerials, serial, device.id)
  }

  const candidateDeviceIds = new Set<string>(crosswalkCandidateIds)
  for (const serialNumber of serialNumbers) {
    for (const id of canonicalSerials.get(serialNumber) ?? []) {
      candidateDeviceIds.add(id)
    }
  }

  const allCrosswalksById = new Map<string, IdentityCandidateCrosswalk>()
  for (const part of chunks([...candidateDeviceIds])) {
    const records = await prisma.importerV2DeviceCrosswalk.findMany({
      where: { canonicalDeviceId: { in: part } },
      orderBy: [
        { canonicalDeviceId: 'asc' },
        { provider: 'asc' },
        { id: 'asc' },
      ],
      select: identityCrosswalkSelect,
    })
    for (const record of records) allCrosswalksById.set(record.id, record)
  }
  const allCrosswalks = [...allCrosswalksById.values()]

  const crosswalksByDevice = new Map<string, IdentityCandidateCrosswalk[]>()
  const providerSourceIds = new Map<string, Set<string>>()
  const crosswalkSerials = new Map<string, Set<string>>()
  const crosswalkMacs = new Map<string, Set<string>>()
  for (const crosswalk of allCrosswalks) {
    crosswalksByDevice.set(crosswalk.canonicalDeviceId, [
      ...(crosswalksByDevice.get(crosswalk.canonicalDeviceId) ?? []),
      crosswalk,
    ])
    if (crosswalk.provider === input.provider) {
      addCandidateIndex(
        providerSourceIds,
        crosswalk.normalizedSourceId,
        crosswalk.canonicalDeviceId,
      )
    }
    addCandidateIndex(
      crosswalkSerials,
      crosswalk.normalizedSerialNumber,
      crosswalk.canonicalDeviceId,
    )
    addCandidateIndex(
      crosswalkMacs,
      crosswalk.normalizedMacAddress,
      crosswalk.canonicalDeviceId,
    )
  }

  return (identifiers) => {
    const normalized = normalizeImporterV2Identity(identifiers)

    // Same-provider confirmed Source ID is the strongest identity path. Never
    // compare the opaque text to source IDs from another provider.
    const providerSourceMatches = normalized.sourceId
      ? [...(providerSourceIds.get(normalized.sourceId) ?? [])]
      : []
    const candidateIds =
      providerSourceMatches.length > 0
        ? new Set(providerSourceMatches)
        : new Set<string>([
            ...(normalized.serialNumber
              ? [...(crosswalkSerials.get(normalized.serialNumber) ?? [])]
              : []),
            ...(normalized.macAddress
              ? [...(crosswalkMacs.get(normalized.macAddress) ?? [])]
              : []),
            ...(normalized.serialNumber
              ? [...(canonicalSerials.get(normalized.serialNumber) ?? [])]
              : []),
          ])

    return [...candidateIds]
      .sort((left, right) => left.localeCompare(right))
      .map((canonicalDeviceId): ImporterV2IdentityCandidate => {
        const device = devicesById.get(canonicalDeviceId)
        const crosswalks = crosswalksByDevice.get(canonicalDeviceId) ?? []
        const sameProvider = crosswalks.find(
          (crosswalk) => crosswalk.provider === input.provider,
        )
        const providerSourceMatch = Boolean(
          normalized.sourceId &&
            sameProvider?.normalizedSourceId === normalized.sourceId,
        )
        const sameProviderAliasMatch = Boolean(
          sameProvider &&
            ((normalized.serialNumber &&
              sameProvider.normalizedSerialNumber === normalized.serialNumber) ||
              (normalized.macAddress &&
                sameProvider.normalizedMacAddress === normalized.macAddress)),
        )
        const crossProviderAliasMatch = crosswalks.some(
          (crosswalk) =>
            crosswalk.provider !== input.provider &&
            ((normalized.serialNumber &&
              crosswalk.normalizedSerialNumber === normalized.serialNumber) ||
              (normalized.macAddress &&
                crosswalk.normalizedMacAddress === normalized.macAddress)),
        )
        const canonicalSerial = normalizeImporterV2Identity({
          serialNumber: device?.serialNumber ?? null,
        }).serialNumber
        const canonicalSerialMatch = Boolean(
          normalized.serialNumber &&
            canonicalSerial === normalized.serialNumber,
        )
        const matchScope =
          providerSourceMatch || sameProviderAliasMatch
            ? ('SAME_PROVIDER' as const)
            : crossProviderAliasMatch
              ? ('CROSS_PROVIDER' as const)
              : ('CANONICAL' as const)

        const candidateIdentifiers =
          matchScope === 'SAME_PROVIDER' && sameProvider
            ? {
                sourceId: sameProvider.sourceId,
                serialNumber: sameProvider.serialNumber,
                macAddress: sameProvider.macAddress,
              }
            : {
                sourceId: null,
                serialNumber:
                  canonicalSerialMatch ||
                  matchingCrosswalkIdentifier(
                    crosswalks,
                    'normalizedSerialNumber',
                    normalized.serialNumber,
                  )
                    ? identifiers.serialNumber ?? normalized.serialNumber
                    : null,
                macAddress: matchingCrosswalkIdentifier(
                  crosswalks,
                  'normalizedMacAddress',
                  normalized.macAddress,
                )
                  ? identifiers.macAddress ?? normalized.macAddress
                  : null,
              }

        return {
          canonicalDeviceId,
          crosswalkId:
            matchScope === 'SAME_PROVIDER' ? sameProvider?.id ?? null : null,
          matchScope,
          identifiers: candidateIdentifiers,
          context: candidateContext(device),
          evidence: [
            ...(device?.serialNumber
              ? [
                  {
                    kind: 'CANONICAL' as const,
                    provider: null,
                    sourceId: null,
                    serialNumber: device.serialNumber,
                    macAddress: null,
                  },
                ]
              : []),
            ...crosswalks.map((crosswalk) => ({
              kind: 'CROSSWALK' as const,
              provider: crosswalk.provider,
              crosswalkId: crosswalk.id,
              lastSeenAt: crosswalk.lastSeenAt?.toISOString() ?? null,
              sourceId: crosswalk.rawSourceId ?? crosswalk.sourceId,
              serialNumber:
                crosswalk.rawSerialNumber ?? crosswalk.serialNumber,
              macAddress: crosswalk.rawMacAddress ?? crosswalk.macAddress,
              sourceIdState:
                crosswalk.sourceIdEvidenceState ??
                (crosswalk.sourceId ? 'ACCEPTED' : null),
              serialNumberState:
                crosswalk.serialNumberEvidenceState ??
                (crosswalk.serialNumber ? 'ACCEPTED' : null),
              macAddressState:
                crosswalk.macAddressEvidenceState ??
                (crosswalk.macAddress ? 'ACCEPTED' : null),
            })),
          ],
          hasConflictingDurableEvidence:
            !providerSourceMatch &&
            hasConflictingCrossProviderEvidence({
              normalized,
              device,
              crosswalks,
            }),
        }
      })
  }
}

export async function findImporterV2IdentityCandidates(input: {
  provider: string
  sourceAdapterId: string
  identifiers: ImporterV2IdentityIdentifiers
}): Promise<ImporterV2IdentityCandidate[]> {
  // sourceAdapterId stays provenance-only. Provider identity survives transport
  // changes, and cross-provider discovery is shared by every adapter.
  void input.sourceAdapterId
  const resolveCandidates = await buildImporterV2IdentityCandidateResolver({
    provider: input.provider,
    identifiers: [input.identifiers],
  })
  return resolveCandidates(input.identifiers)
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
          provider_canonicalDeviceId: {
            provider: input.provider,
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
          rawSourceId: raw.sourceId,
          rawSerialNumber: raw.serialNumber,
          rawMacAddress: raw.macAddress,
          sourceIdEvidenceState: raw.sourceId ? 'ACCEPTED' : null,
          serialNumberEvidenceState: raw.serialNumber ? 'ACCEPTED' : null,
          macAddressEvidenceState: raw.macAddress ? 'ACCEPTED' : null,
          confirmedAt: publishedAt,
          lastSeenAt: publishedAt,
        },
        update: {
          sourceAdapterId: input.sourceAdapterId,
          ...raw,
          normalizedSourceId: normalized.sourceId,
          normalizedSerialNumber: normalized.serialNumber,
          normalizedMacAddress: normalized.macAddress,
          rawSourceId: raw.sourceId,
          rawSerialNumber: raw.serialNumber,
          rawMacAddress: raw.macAddress,
          sourceIdEvidenceState: raw.sourceId ? 'ACCEPTED' : null,
          serialNumberEvidenceState: raw.serialNumber ? 'ACCEPTED' : null,
          macAddressEvidenceState: raw.macAddress ? 'ACCEPTED' : null,
          confirmedAt: publishedAt,
          lastSeenAt: publishedAt,
        },
      })
      crosswalksPersisted += 1
    }

    return { snapshotId: snapshot.id, crosswalksPersisted }
  })
}
