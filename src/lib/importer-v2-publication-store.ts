import { prisma } from '@/lib/prisma'
import type { Prisma } from '../generated/prisma/client'
import { normalizeImporterV2Identity } from '@/lib/importer-v2-identity'
import {
  buildImporterV2PublicationQa,
  importerV2CatalogProposalKey,
  importerV2OwnedDeviceScalarPatch,
  selectImporterV2PublicationRows,
  type ImporterV2CatalogProposalField,
  type ImporterV2PublicationMode,
  type ImporterV2PublicationQa,
  type ImporterV2PublicationQaRowInput,
} from '@/lib/importer-v2-publication'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

export class ImporterV2PublicationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImporterV2PublicationConflictError'
  }
}

export class ImporterV2PublicationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImporterV2PublicationValidationError'
  }
}

type PublicationTx = Prisma.TransactionClient

type CanonicalTarget = { id?: string | null; label?: string } | null

type EffectiveSnapshot = {
  rawValues?: Record<string, string | null>
  normalizedValues?: Record<string, string | null>
  proposedCanonicalValues?: Record<string, CanonicalTarget>
  firmware?: {
    interpreterId?: string
    interpreterVersion?: string
    compatibility?: { status?: string }
    warnings?: unknown[]
    [key: string]: unknown
  }
}

type RepeatDiff = {
  proposals?: Array<{ field?: string; allowed?: boolean; reason?: string }>
}

const qaBatchSelect = {
  id: true,
  name: true,
  provider: true,
  sourceAdapterId: true,
  profileId: true,
  profileVersion: true,
  evaluationFingerprint: true,
  status: true,
  rowCount: true,
  publishedRowCount: true,
  rows: {
    orderBy: { rowNumber: 'asc' as const },
    select: {
      id: true,
      rowNumber: true,
      sourceFingerprint: true,
      inclusion: true,
      statuses: true,
      primaryStatus: true,
      repeatClassification: true,
      needsReevaluation: true,
      reviewRevision: true,
      publishedAt: true,
      publicationAttemptId: true,
      firmwareEvidencePattern: true,
      evaluated: true,
      identityResolution: true,
      repeatDiff: true,
      decisions: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        select: {
          field: true,
          action: true,
          value: true,
          explanation: true,
          actorUserId: true,
          createdAt: true,
        },
      },
    },
  },
} as const

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function text(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function slug(value: string) {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'IMPORT'
  )
}

function qaInput(batch: Awaited<ReturnType<typeof loadBatchForQa>>) {
  if (!batch)
    throw new ImporterV2PublicationValidationError('Importer batch was not found.')
  return {
    batch: {
      id: batch.id,
      name: batch.name,
      provider: batch.provider,
      sourceAdapterId: batch.sourceAdapterId,
      profileId: batch.profileId,
      profileVersion: batch.profileVersion,
      evaluationFingerprint: batch.evaluationFingerprint,
      status: batch.status,
      rowCount: batch.rowCount,
      publishedRowCount: batch.publishedRowCount,
    },
    rows: batch.rows as unknown as ImporterV2PublicationQaRowInput[],
  }
}

async function loadBatchForQa(
  client: Pick<typeof prisma, 'importerV2WorkspaceBatch'>,
  batchId: string,
) {
  return client.importerV2WorkspaceBatch.findUnique({
    where: { id: batchId },
    select: qaBatchSelect,
  })
}

export async function getImporterV2PublicationQa(batchId: string) {
  const batch = await loadBatchForQa(prisma, batchId)
  return buildImporterV2PublicationQa(qaInput(batch))
}

function effectiveSnapshot(row: ImporterV2PublicationQaRowInput) {
  return importerV2WorkspaceEffectiveEvaluated({
    evaluated: row.evaluated,
    inclusion: row.inclusion,
    decisions: row.decisions,
  }).evaluated as EffectiveSnapshot
}

function target(snapshot: EffectiveSnapshot, field: string): CanonicalTarget {
  return snapshot.proposedCanonicalValues?.[field] ?? null
}

function targetLabel(snapshot: EffectiveSnapshot, field: string) {
  return text(target(snapshot, field)?.label)
}

function targetId(snapshot: EffectiveSnapshot, field: string) {
  return text(target(snapshot, field)?.id)
}

function effectiveText(snapshot: EffectiveSnapshot, field: string) {
  return targetLabel(snapshot, field) ?? text(snapshot.rawValues?.[field])
}

function proposalContext(
  field: ImporterV2CatalogProposalField,
  snapshot: EffectiveSnapshot,
) {
  const key = (name: string) =>
    targetId(snapshot, name) ?? targetLabel(snapshot, name)
  switch (field) {
    case 'businessUnit':
      return { customer: key('customer') }
    case 'site':
      return {
        customer: key('customer'),
        businessUnit: key('businessUnit'),
      }
    case 'productFamily':
      return { vendor: key('vendor') }
    case 'model':
      return {
        vendor: key('vendor'),
        deviceType: key('deviceType'),
        productFamily: key('productFamily'),
      }
    case 'currentFirmware':
      return {
        vendor: key('vendor'),
        softwarePlatform: key('softwarePlatform'),
      }
    default:
      return {}
  }
}

function assertApprovedProposal(input: {
  field: ImporterV2CatalogProposalField
  label: string
  snapshot: EffectiveSnapshot
  approvals: Set<string>
}) {
  const key = importerV2CatalogProposalKey({
    field: input.field,
    label: input.label,
    context: proposalContext(input.field, input.snapshot),
  })
  if (!input.approvals.has(key)) {
    throw new ImporterV2PublicationValidationError(
      `Canonical ${input.field} proposal “${input.label}” was not explicitly approved.`,
    )
  }
  return key
}

async function exactOne<T extends { id: string }>(
  records: T[],
  description: string,
): Promise<T | null> {
  if (records.length > 1) {
    throw new ImporterV2PublicationConflictError(
      `Multiple canonical ${description} records now match this approved proposal.`,
    )
  }
  return records[0] ?? null
}

async function ensureCustomer(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  provider: string,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'customer')
  if (id) {
    const record = await tx.customer.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected customer is missing or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'customer')
  if (!label)
    throw new ImporterV2PublicationValidationError(
      'Customer must be resolved before publication.',
    )
  assertApprovedProposal({ field: 'customer', label, snapshot, approvals })
  const existing = await exactOne(
    await tx.customer.findMany({
      where: { name: { equals: label, mode: 'insensitive' } },
      select: { id: true },
    }),
    'customer',
  )
  if (existing) return existing.id
  return (
    await tx.customer.create({
      data: {
        name: label,
        source: 'IMPORT',
        externalProvider: provider,
      },
      select: { id: true },
    })
  ).id
}

async function ensureBusinessUnit(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  customerId: string,
  provider: string,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'businessUnit')
  if (id) {
    const record = await tx.customerOrganizationUnit.findFirst({
      where: { id, customerId },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected organizational unit is outside the customer or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'businessUnit')
  if (!label) return null
  assertApprovedProposal({
    field: 'businessUnit',
    label,
    snapshot,
    approvals,
  })
  const existing = await exactOne(
    await tx.customerOrganizationUnit.findMany({
      where: {
        customerId,
        parentId: null,
        name: { equals: label, mode: 'insensitive' },
      },
      select: { id: true },
    }),
    'organizational unit',
  )
  if (existing) return existing.id
  return (
    await tx.customerOrganizationUnit.create({
      data: {
        customerId,
        parentId: null,
        name: label,
        source: 'IMPORT',
        externalProvider: provider,
      },
      select: { id: true },
    })
  ).id
}

async function ensureSite(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  customerId: string,
  organizationUnitId: string | null,
  provider: string,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'site')
  if (id) {
    const record = await tx.site.findFirst({
      where: { id, customerId, organizationUnitId },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected site is outside the Customer → organizational unit context or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'site')
  if (!label)
    throw new ImporterV2PublicationValidationError(
      'Site must be resolved before publication.',
    )
  assertApprovedProposal({ field: 'site', label, snapshot, approvals })
  const existing = await exactOne(
    await tx.site.findMany({
      where: {
        customerId,
        organizationUnitId,
        name: { equals: label, mode: 'insensitive' },
      },
      select: { id: true },
    }),
    'site',
  )
  if (existing) return existing.id
  return (
    await tx.site.create({
      data: {
        customerId,
        organizationUnitId,
        name: label,
        source: 'IMPORT',
        externalProvider: provider,
      },
      select: { id: true },
    })
  ).id
}

async function ensureVendor(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'vendor')
  if (id) {
    const record = await tx.vendor.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected vendor is missing or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'vendor')
  if (!label)
    throw new ImporterV2PublicationValidationError(
      'Vendor must be resolved before publication.',
    )
  const proposalKey = assertApprovedProposal({
    field: 'vendor',
    label,
    snapshot,
    approvals,
  })
  const existing = await tx.vendor.findFirst({
    where: { name: { equals: label, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return existing.id
  return (
    await tx.vendor.create({
      data: {
        name: label,
        code: `IMP-${slug(label)}-${proposalKey.slice(0, 6).toUpperCase()}`,
      },
      select: { id: true },
    })
  ).id
}

async function ensureDeviceType(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'deviceType')
  if (id) {
    const record = await tx.deviceType.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected device type is missing or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'deviceType')
  if (!label)
    throw new ImporterV2PublicationValidationError(
      'Device type must be resolved before publication.',
    )
  const proposalKey = assertApprovedProposal({
    field: 'deviceType',
    label,
    snapshot,
    approvals,
  })
  const existing = await tx.deviceType.findFirst({
    where: { name: { equals: label, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return existing.id
  return (
    await tx.deviceType.create({
      data: {
        name: label,
        code: `IMP-${slug(label)}-${proposalKey.slice(0, 6).toUpperCase()}`,
      },
      select: { id: true },
    })
  ).id
}

async function ensureFamily(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  vendorId: string,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'productFamily')
  if (id) {
    const record = await tx.deviceModelFamily.findFirst({
      where: { id, vendorId },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected product family is outside the vendor or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'productFamily')
  if (!label) return null
  assertApprovedProposal({
    field: 'productFamily',
    label,
    snapshot,
    approvals,
  })
  const existing = await tx.deviceModelFamily.findFirst({
    where: { vendorId, name: { equals: label, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return existing.id
  return (
    await tx.deviceModelFamily.create({
      data: { vendorId, name: label },
      select: { id: true },
    })
  ).id
}

async function ensureModel(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  vendorId: string,
  deviceTypeId: string,
  familyId: string | null,
  provider: string,
  approvals: Set<string>,
) {
  const id = targetId(snapshot, 'model')
  if (id) {
    const record = await tx.deviceModel.findFirst({
      where: { id, vendorId },
      select: { id: true, isActive: true },
    })
    if (!record?.isActive)
      throw new ImporterV2PublicationConflictError(
        'Selected model is outside the vendor or inactive.',
      )
    return record.id
  }
  const label = targetLabel(snapshot, 'model')
  if (!label)
    throw new ImporterV2PublicationValidationError(
      'Canonical model must be resolved before publication.',
    )
  assertApprovedProposal({ field: 'model', label, snapshot, approvals })
  const existing = await tx.deviceModel.findUnique({
    where: { vendorId_model: { vendorId, model: label } },
    select: { id: true },
  })
  if (existing) return existing.id
  return (
    await tx.deviceModel.create({
      data: {
        vendorId,
        deviceTypeId,
        familyId,
        model: label,
        platform: targetLabel(snapshot, 'softwarePlatform'),
        source: 'IMPORT',
        externalProvider: provider,
      },
      select: { id: true },
    })
  ).id
}

async function ensureObservedRelease(
  tx: PublicationTx,
  snapshot: EffectiveSnapshot,
  vendorId: string,
  provider: string,
  approvals: Set<string>,
) {
  const rawVersion = targetLabel(snapshot, 'currentFirmware')
  if (!rawVersion) return { releaseId: null, rawVersion: null }
  const platform = targetLabel(snapshot, 'softwarePlatform')
  const id = targetId(snapshot, 'currentFirmware')
  if (id) {
    const release = await tx.firmwareRelease.findUnique({
      where: { id },
      select: { id: true, vendorId: true, platform: true, isActive: true },
    })
    if (!release?.isActive || release.vendorId !== vendorId) {
      throw new ImporterV2PublicationConflictError(
        'Selected firmware release is missing, inactive, or belongs to another vendor.',
      )
    }
    if (
      platform &&
      release.platform.toLocaleLowerCase('en-US') !==
        platform.toLocaleLowerCase('en-US')
    ) {
      throw new ImporterV2PublicationConflictError(
        'Selected firmware release no longer matches the staged software platform.',
      )
    }
    return { releaseId: release.id, rawVersion }
  }
  if (!platform) return { releaseId: null, rawVersion }
  assertApprovedProposal({
    field: 'currentFirmware',
    label: rawVersion,
    snapshot,
    approvals,
  })
  const existing = await tx.firmwareRelease.findUnique({
    where: {
      vendorId_platform_version: {
        vendorId,
        platform,
        version: rawVersion,
      },
    },
    select: { id: true },
  })
  if (existing) return { releaseId: existing.id, rawVersion }
  const created = await tx.firmwareRelease.create({
    data: {
      vendorId,
      platform,
      version: rawVersion,
      logicalVersion: rawVersion,
      catalogState: 'OBSERVED',
      policyEligibility: 'NOT_EVALUATED',
      status: 'AVAILABLE',
      source: 'IMPORT',
      externalProvider: provider,
      lastSynchronizedAt: new Date(),
    },
    select: { id: true },
  })
  return { releaseId: created.id, rawVersion }
}

function identityDecision(row: ImporterV2PublicationQaRowInput) {
  const review = importerV2WorkspaceIdentityReview({
    identityResolution: row.identityResolution,
    decisions: row.decisions,
  })
  if (!review || review.requiresConfirmation || review.kind === 'INVALID') {
    throw new ImporterV2PublicationConflictError(
      `Row ${row.rowNumber} no longer has a publishable durable identity decision.`,
    )
  }
  if (review.selectedDecision === 'CREATE_NEW') return null
  if (review.selectedCanonicalDeviceId) return review.selectedCanonicalDeviceId
  if (review.candidates.length === 1 && !review.requiresConfirmation)
    return review.candidates[0].canonicalDeviceId
  throw new ImporterV2PublicationConflictError(
    `Row ${row.rowNumber} does not identify one canonical device or an explicit Create new decision.`,
  )
}

function identifiers(snapshot: EffectiveSnapshot) {
  return {
    sourceId: effectiveText(snapshot, 'sourceId'),
    serialNumber: effectiveText(snapshot, 'serialNumber'),
    macAddress: effectiveText(snapshot, 'macAddress'),
  }
}

async function assertIdentityStillUnique(
  tx: PublicationTx,
  provider: string,
  chosenDeviceId: string | null,
  sourceIdentifiers: ReturnType<typeof identifiers>,
) {
  const normalized = normalizeImporterV2Identity(sourceIdentifiers)
  const OR: Array<Record<string, string>> = []
  if (normalized.sourceId)
    OR.push({ normalizedSourceId: normalized.sourceId })
  if (normalized.serialNumber)
    OR.push({ normalizedSerialNumber: normalized.serialNumber })
  if (normalized.macAddress)
    OR.push({ normalizedMacAddress: normalized.macAddress })
  if (OR.length === 0)
    throw new ImporterV2PublicationConflictError(
      'Durable source identity disappeared before publication.',
    )
  const matches = await tx.importerV2DeviceCrosswalk.findMany({
    where: { provider, OR },
    select: { canonicalDeviceId: true },
  })
  const conflicting = [
    ...new Set(matches.map((item) => item.canonicalDeviceId)),
  ].filter((id) => id !== chosenDeviceId)
  if (conflicting.length > 0) {
    throw new ImporterV2PublicationConflictError(
      'Durable source identity is now associated with another canonical device.',
    )
  }
  return normalized
}

function allowedUpdateFields(row: ImporterV2PublicationQaRowInput) {
  const diff = row.repeatDiff as RepeatDiff | null
  if (!diff?.proposals)
    return new Set<string>([
      'currentFirmware',
      'firmwareVersion',
      'softwareVersion',
    ])
  return new Set(
    diff.proposals
      .filter((proposal) => proposal.allowed)
      .map((proposal) => proposal.field ?? ''),
  )
}

function snapshotValues(snapshot: EffectiveSnapshot) {
  const result: Record<string, string | null> = {}
  const fields = new Set([
    ...Object.keys(snapshot.rawValues ?? {}),
    ...Object.keys(snapshot.proposedCanonicalValues ?? {}),
  ])
  for (const field of fields) result[field] = effectiveText(snapshot, field)
  return result
}

async function publishRow(input: {
  tx: PublicationTx
  batch: NonNullable<Awaited<ReturnType<typeof loadBatchForQa>>>
  row: ImporterV2PublicationQaRowInput
  publicationAttemptId: string
  publishedAt: Date
  approvals: Set<string>
  actorUserId: string | null
}) {
  const { tx, batch, row, publicationAttemptId, publishedAt, approvals } = input
  const snapshot = effectiveSnapshot(row)
  const sourceIdentifiers = identifiers(snapshot)
  const identityDeviceId = identityDecision(row)
  const normalizedIdentity = await assertIdentityStillUnique(
    tx,
    batch.provider,
    identityDeviceId,
    sourceIdentifiers,
  )

  const customerId = await ensureCustomer(
    tx,
    snapshot,
    batch.provider,
    approvals,
  )
  const organizationUnitId = await ensureBusinessUnit(
    tx,
    snapshot,
    customerId,
    batch.provider,
    approvals,
  )
  const siteId = await ensureSite(
    tx,
    snapshot,
    customerId,
    organizationUnitId,
    batch.provider,
    approvals,
  )
  const vendorId = await ensureVendor(tx, snapshot, approvals)
  const deviceTypeId = await ensureDeviceType(tx, snapshot, approvals)
  const familyId = await ensureFamily(tx, snapshot, vendorId, approvals)
  const deviceModelId = await ensureModel(
    tx,
    snapshot,
    vendorId,
    deviceTypeId,
    familyId,
    batch.provider,
    approvals,
  )
  const observedRelease = await ensureObservedRelease(
    tx,
    snapshot,
    vendorId,
    batch.provider,
    approvals,
  )
  const firmwareCompatible =
    snapshot.firmware?.compatibility?.status === 'COMPATIBLE'
  const currentFirmwareReleaseId = firmwareCompatible
    ? observedRelease.releaseId
    : null
  const currentFirmwareRawVersion = observedRelease.rawVersion
  const name =
    effectiveText(snapshot, 'deviceName') ?? effectiveText(snapshot, 'hostname')
  if (!name)
    throw new ImporterV2PublicationValidationError(
      `Row ${row.rowNumber} has no publishable device name.`,
    )

  let canonicalDeviceId = identityDeviceId
  let created = false
  let beforeFirmware: {
    releaseId: string | null
    rawVersion: string | null
  } | null = null
  if (canonicalDeviceId) {
    const current = await tx.device.findUnique({
      where: { id: canonicalDeviceId },
      select: {
        id: true,
        customerId: true,
        siteId: true,
        deviceModelId: true,
        name: true,
        hostname: true,
        serialNumber: true,
        managementAddress: true,
        notes: true,
        currentFirmwareReleaseId: true,
        currentFirmwareRawVersion: true,
      },
    })
    if (!current)
      throw new ImporterV2PublicationConflictError(
        `Canonical device for row ${row.rowNumber} was deleted before publication.`,
      )
    beforeFirmware = {
      releaseId: current.currentFirmwareReleaseId,
      rawVersion: current.currentFirmwareRawVersion,
    }
    const allowed = allowedUpdateFields(row)
    const data: Prisma.DeviceUpdateInput = {
      currentFirmwareRelease: currentFirmwareReleaseId
        ? { connect: { id: currentFirmwareReleaseId } }
        : { disconnect: true },
      currentFirmwareObservedAt: currentFirmwareRawVersion ? publishedAt : null,
      currentFirmwareSource: 'IMPORT',
      currentFirmwareRawVersion,
      currentFirmwareNormalizedVersion: currentFirmwareRawVersion,
      currentFirmwareEvidence: jsonValue({
        rawFirmwareVersion: snapshot.rawValues?.firmwareVersion ?? null,
        rawSoftwareVersion: snapshot.rawValues?.softwareVersion ?? null,
        interpretation: snapshot.firmware ?? null,
      }),
      currentFirmwareInterpreterId: text(snapshot.firmware?.interpreterId),
      currentFirmwareInterpreterVersion: text(
        snapshot.firmware?.interpreterVersion,
      ),
      lastSynchronizedAt: publishedAt,
    }
    if (allowed.has('customer')) data.customer = { connect: { id: customerId } }
    if (allowed.has('site')) data.site = { connect: { id: siteId } }
    if (allowed.has('model'))
      data.deviceModel = { connect: { id: deviceModelId } }
    Object.assign(
      data,
      importerV2OwnedDeviceScalarPatch({
        allowedFields: allowed,
        values: {
          deviceName: name,
          hostname: effectiveText(snapshot, 'hostname'),
          serialNumber: effectiveText(snapshot, 'serialNumber'),
          managementAddress: effectiveText(snapshot, 'managementAddress'),
          notes: effectiveText(snapshot, 'notes'),
        },
      }),
    )
    await tx.device.update({ where: { id: canonicalDeviceId }, data })
  } else {
    const createdDevice = await tx.device.create({
      data: {
        customerId,
        siteId,
        deviceModelId,
        name,
        hostname: effectiveText(snapshot, 'hostname'),
        serialNumber: effectiveText(snapshot, 'serialNumber'),
        managementAddress: effectiveText(snapshot, 'managementAddress'),
        notes: effectiveText(snapshot, 'notes'),
        currentFirmwareReleaseId,
        currentFirmwareObservedAt: currentFirmwareRawVersion
          ? publishedAt
          : null,
        currentFirmwareSource: 'IMPORT',
        currentFirmwareRawVersion,
        currentFirmwareNormalizedVersion: currentFirmwareRawVersion,
        currentFirmwareEvidence: jsonValue({
          rawFirmwareVersion: snapshot.rawValues?.firmwareVersion ?? null,
          rawSoftwareVersion: snapshot.rawValues?.softwareVersion ?? null,
          interpretation: snapshot.firmware ?? null,
        }),
        currentFirmwareInterpreterId: text(snapshot.firmware?.interpreterId),
        currentFirmwareInterpreterVersion: text(
          snapshot.firmware?.interpreterVersion,
        ),
        source: 'IMPORT',
        externalProvider: batch.provider,
        externalId: sourceIdentifiers.sourceId,
        lastSynchronizedAt: publishedAt,
      },
      select: { id: true },
    })
    canonicalDeviceId = createdDevice.id
    created = true
  }

  if (!canonicalDeviceId)
    throw new ImporterV2PublicationConflictError(
      'Publication could not establish a canonical device ID.',
    )
  const normalizedAfterCreate = await assertIdentityStillUnique(
    tx,
    batch.provider,
    canonicalDeviceId,
    sourceIdentifiers,
  )
  await tx.importerV2DeviceCrosswalk.upsert({
    where: {
      provider_canonicalDeviceId: {
        provider: batch.provider,
        canonicalDeviceId,
      },
    },
    create: {
      provider: batch.provider,
      sourceAdapterId: batch.sourceAdapterId,
      canonicalDeviceId,
      sourceId: sourceIdentifiers.sourceId,
      normalizedSourceId: normalizedAfterCreate.sourceId,
      serialNumber: sourceIdentifiers.serialNumber,
      normalizedSerialNumber: normalizedAfterCreate.serialNumber,
      macAddress: sourceIdentifiers.macAddress,
      normalizedMacAddress: normalizedAfterCreate.macAddress,
      confirmedAt: publishedAt,
      lastSeenAt: publishedAt,
    },
    update: {
      sourceAdapterId: batch.sourceAdapterId,
      sourceId: sourceIdentifiers.sourceId,
      normalizedSourceId: normalizedAfterCreate.sourceId,
      serialNumber: sourceIdentifiers.serialNumber,
      normalizedSerialNumber: normalizedAfterCreate.serialNumber,
      macAddress: sourceIdentifiers.macAddress,
      normalizedMacAddress: normalizedAfterCreate.macAddress,
      confirmedAt: publishedAt,
      lastSeenAt: publishedAt,
    },
  })

  await tx.importerV2WorkspaceRow.update({
    where: { id: row.id },
    data: { publishedAt, publicationAttemptId },
  })

  if (
    beforeFirmware &&
    (beforeFirmware.releaseId !== currentFirmwareReleaseId ||
      beforeFirmware.rawVersion !== currentFirmwareRawVersion)
  ) {
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        customerId,
        action: 'CURRENT_FIRMWARE_CHANGED',
        entityType: 'Device',
        entityId: canonicalDeviceId,
        before: {
          firmwareReleaseId: beforeFirmware.releaseId,
          rawVersion: beforeFirmware.rawVersion,
        },
        after: {
          firmwareReleaseId: currentFirmwareReleaseId,
          rawVersion: currentFirmwareRawVersion,
        },
        metadata: {
          context: 'IMPORTER_V2_PUBLICATION',
          batchId: batch.id,
          publicationAttemptId,
        },
      },
    })
  }

  return {
    rowNumber: row.rowNumber,
    canonicalDeviceId,
    created,
    sourceIdentifiers,
    normalizedIdentity,
    values: snapshotValues(snapshot),
    rowFingerprint: row.sourceFingerprint,
  }
}

function publishedResult(attempt: {
  id: string
  result: unknown
  status: string
}) {
  if (attempt.status !== 'SUCCEEDED' || !attempt.result) {
    throw new ImporterV2PublicationConflictError(
      'An idempotent publication record exists but is not a completed publication.',
    )
  }
  return attempt.result
}

export async function publishImporterV2Batch(input: {
  batchId: string
  mode: ImporterV2PublicationMode
  qaFingerprint: string
  idempotencyKey: string
  approvedProposalKeys: readonly string[]
  actorUserId?: string | null
}) {
  const idempotencyKey = text(input.idempotencyKey)
  if (!idempotencyKey)
    throw new ImporterV2PublicationValidationError('idempotencyKey is required.')
  const existing = await prisma.importerV2PublicationAttempt.findUnique({
    where: {
      batchId_idempotencyKey: { batchId: input.batchId, idempotencyKey },
    },
    select: { id: true, status: true, result: true },
  })
  if (existing) return publishedResult(existing)

  try {
    return await prisma.$transaction(
      async (tx) => {
        const repeated = await tx.importerV2PublicationAttempt.findUnique({
          where: {
            batchId_idempotencyKey: {
              batchId: input.batchId,
              idempotencyKey,
            },
          },
          select: { id: true, status: true, result: true },
        })
        if (repeated) return publishedResult(repeated)

        const batch = await loadBatchForQa(
          tx as unknown as Pick<typeof prisma, 'importerV2WorkspaceBatch'>,
          input.batchId,
        )
        if (!batch)
          throw new ImporterV2PublicationValidationError(
            'Importer batch was not found.',
          )
        const qa = buildImporterV2PublicationQa(qaInput(batch))
        if (qa.qaFingerprint !== input.qaFingerprint) {
          throw new ImporterV2PublicationConflictError(
            'The staged QA snapshot changed after review. Reload QA before publishing.',
          )
        }
        const rowNumbers = selectImporterV2PublicationRows(qa, input.mode)
        const selected = new Set(rowNumbers)
        const approvals = new Set(input.approvedProposalKeys)
        const requiredProposalKeys = qa.catalogProposals
          .filter((proposal) =>
            proposal.rowNumbers.some((rowNumber) => selected.has(rowNumber)),
          )
          .map((proposal) => proposal.key)
        const missingApprovals = requiredProposalKeys.filter(
          (key) => !approvals.has(key),
        )
        if (missingApprovals.length > 0) {
          throw new ImporterV2PublicationValidationError(
            `${missingApprovals.length} canonical proposal(s) still require explicit approval.`,
          )
        }

        const publishedAt = new Date()
        const attempt = await tx.importerV2PublicationAttempt.create({
          data: {
            batchId: batch.id,
            idempotencyKey,
            mode: input.mode,
            qaFingerprint: qa.qaFingerprint,
            status: 'COMMITTING',
            approvedProposalKeys: [
              ...new Set(input.approvedProposalKeys),
            ].sort(),
            actorUserId: input.actorUserId ?? null,
            sourceMetadata: jsonValue({
              name: batch.name,
              provider: batch.provider,
              sourceAdapterId: batch.sourceAdapterId,
              profileId: batch.profileId,
              profileVersion: batch.profileVersion,
              evaluationFingerprint: batch.evaluationFingerprint,
            }),
            publishedAt,
          },
          select: { id: true },
        })

        const rowsByNumber = new Map(
          batch.rows.map((row) => [
            row.rowNumber,
            row as unknown as ImporterV2PublicationQaRowInput,
          ]),
        )
        const publishedRows = []
        for (const rowNumber of rowNumbers) {
          const row = rowsByNumber.get(rowNumber)
          if (!row)
            throw new ImporterV2PublicationConflictError(
              `QA-selected row ${rowNumber} disappeared before publication.`,
            )
          publishedRows.push(
            await publishRow({
              tx,
              batch,
              row,
              publicationAttemptId: attempt.id,
              publishedAt,
              approvals,
              actorUserId: input.actorUserId ?? null,
            }),
          )
        }

        const previousSnapshot = await tx.importerV2SourceSnapshot.findFirst({
          where: {
            provider: batch.provider,
            sourceAdapterId: batch.sourceAdapterId,
            evaluationFingerprint: batch.evaluationFingerprint,
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          include: { rows: { orderBy: { rowNumber: 'asc' } } },
        })
        const cumulativeRows = new Map<
          number,
          {
            rowNumber: number
            canonicalDeviceId: string | null
            sourceRecordKey: string | null
            rowFingerprint: string
            sourceId: string | null
            normalizedSourceId: string | null
            serialNumber: string | null
            normalizedSerialNumber: string | null
            macAddress: string | null
            normalizedMacAddress: string | null
            values: unknown
          }
        >()
        for (const row of previousSnapshot?.rows ?? []) {
          cumulativeRows.set(row.rowNumber, {
            rowNumber: row.rowNumber,
            canonicalDeviceId: row.canonicalDeviceId,
            sourceRecordKey: row.sourceRecordKey,
            rowFingerprint: row.rowFingerprint,
            sourceId: row.sourceId,
            normalizedSourceId: row.normalizedSourceId,
            serialNumber: row.serialNumber,
            normalizedSerialNumber: row.normalizedSerialNumber,
            macAddress: row.macAddress,
            normalizedMacAddress: row.normalizedMacAddress,
            values: row.values,
          })
        }
        for (const row of publishedRows) {
          cumulativeRows.set(row.rowNumber, {
            rowNumber: row.rowNumber,
            canonicalDeviceId: row.canonicalDeviceId,
            sourceRecordKey: row.sourceIdentifiers.sourceId,
            rowFingerprint: row.rowFingerprint,
            sourceId: row.sourceIdentifiers.sourceId,
            normalizedSourceId: row.normalizedIdentity.sourceId,
            serialNumber: row.sourceIdentifiers.serialNumber,
            normalizedSerialNumber: row.normalizedIdentity.serialNumber,
            macAddress: row.sourceIdentifiers.macAddress,
            normalizedMacAddress: row.normalizedIdentity.macAddress,
            values: row.values,
          })
        }
        for (const row of batch.rows) {
          if (row.inclusion !== 'EXCLUDED') continue
          const staged = row as unknown as ImporterV2PublicationQaRowInput
          const snapshot = effectiveSnapshot(staged)
          const ids = identifiers(snapshot)
          const normalizedIds = normalizeImporterV2Identity(ids)
          cumulativeRows.set(row.rowNumber, {
            rowNumber: row.rowNumber,
            canonicalDeviceId: null,
            sourceRecordKey: ids.sourceId,
            rowFingerprint: row.sourceFingerprint,
            sourceId: ids.sourceId,
            normalizedSourceId: normalizedIds.sourceId,
            serialNumber: ids.serialNumber,
            normalizedSerialNumber: normalizedIds.serialNumber,
            macAddress: ids.macAddress,
            normalizedMacAddress: normalizedIds.macAddress,
            values: snapshotValues(snapshot),
          })
        }

        const remainingIncluded = await tx.importerV2WorkspaceRow.count({
          where: {
            batchId: batch.id,
            inclusion: 'INCLUDED',
            publishedAt: null,
          },
        })
        const publishedRowCount = await tx.importerV2WorkspaceRow.count({
          where: {
            batchId: batch.id,
            inclusion: 'INCLUDED',
            publishedAt: { not: null },
          },
        })
        const completeBatch = remainingIncluded === 0
        const snapshot = await tx.importerV2SourceSnapshot.create({
          data: {
            provider: batch.provider,
            sourceAdapterId: batch.sourceAdapterId,
            profileVersion: batch.profileVersion,
            evaluationFingerprint: batch.evaluationFingerprint,
            publicationAttemptId: attempt.id,
            // Missing-device lifecycle automation is explicitly out of scope
            // for #51; publication therefore never upgrades this evidence to
            // an authoritative full-inventory deletion baseline.
            isFullInventoryExport: false,
            publishedAt,
          },
          select: { id: true },
        })
        if (cumulativeRows.size > 0) {
          await tx.importerV2SourceSnapshotRow.createMany({
            data: [...cumulativeRows.values()]
              .sort((a, b) => a.rowNumber - b.rowNumber)
              .map((row) => ({
                ...row,
                snapshotId: snapshot.id,
                values: jsonValue(row.values),
              })),
          })
        }

        const result = {
          publicationAttemptId: attempt.id,
          snapshotId: snapshot.id,
          batchId: batch.id,
          mode: input.mode,
          publishedAt: publishedAt.toISOString(),
          publishedRows: publishedRows.map((row) => ({
            rowNumber: row.rowNumber,
            canonicalDeviceId: row.canonicalDeviceId,
            action: row.created ? 'CREATE' : 'UPDATE',
          })),
          publishedRowCount,
          remainingIncludedRows: remainingIncluded,
          batchStatus: completeBatch ? 'PUBLISHED' : 'PARTIALLY_PUBLISHED',
          approvedProposalKeys: [
            ...new Set(input.approvedProposalKeys),
          ].sort(),
        }

        await tx.importerV2WorkspaceBatch.update({
          where: { id: batch.id },
          data: {
            status: result.batchStatus,
            publishedRowCount,
          },
        })
        await tx.auditEvent.create({
          data: {
            actorUserId: input.actorUserId ?? null,
            customerId: null,
            action: 'IMPORTER_V2_PUBLISHED',
            entityType: 'ImporterV2WorkspaceBatch',
            entityId: batch.id,
            before: {
              status: batch.status,
              publishedRowCount: batch.publishedRowCount,
            },
            after: { status: result.batchStatus, publishedRowCount },
            metadata: {
              publicationAttemptId: attempt.id,
              mode: input.mode,
              profileId: batch.profileId,
              profileVersion: batch.profileVersion,
              evaluationFingerprint: batch.evaluationFingerprint,
              qaFingerprint: qa.qaFingerprint,
              publishedRows: publishedRows.length,
              remainingIncludedRows: remainingIncluded,
              approvedProposalCount: requiredProposalKeys.length,
            },
          },
        })
        await tx.importerV2PublicationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'SUCCEEDED',
            counts: jsonValue({
              ...qa.counts,
              publishedThisAttempt: publishedRows.length,
              remainingIncludedRows: remainingIncluded,
            }),
            result: jsonValue(result),
          },
        })
        return result
      },
      { isolationLevel: 'Serializable' },
    )
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      const repeated = await prisma.importerV2PublicationAttempt.findUnique({
        where: {
          batchId_idempotencyKey: { batchId: input.batchId, idempotencyKey },
        },
        select: { id: true, status: true, result: true },
      })
      if (repeated) return publishedResult(repeated)
    }
    throw error
  }
}

export function publicationProposalsRequiredForRows(
  qa: ImporterV2PublicationQa,
  rowNumbers: readonly number[],
) {
  const selected = new Set(rowNumbers)
  return qa.catalogProposals.filter((proposal) =>
    proposal.rowNumbers.some((rowNumber) => selected.has(rowNumber)),
  )
}
