import { prisma } from '@/lib/prisma'
import { Prisma } from '../generated/prisma/client'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import {
  resolveImporterV2Identity,
  type ImporterV2IdentityContext,
  type ImporterV2IdentityIdentifiers,
} from '@/lib/importer-v2-identity'
import { findImporterV2IdentityCandidates } from '@/lib/importer-v2-identity-store'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'

const DURABLE_IDENTITY_FIELDS = ['sourceId', 'serialNumber', 'macAddress'] as const

type CanonicalTarget = { id?: string | null; label?: string } | null
type EffectiveSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
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

function identifiers(snapshot: EffectiveSnapshot): ImporterV2IdentityIdentifiers {
  return {
    sourceId: effectiveText(snapshot, 'sourceId'),
    serialNumber: effectiveText(snapshot, 'serialNumber'),
    macAddress: effectiveText(snapshot, 'macAddress'),
  }
}

function context(snapshot: EffectiveSnapshot): ImporterV2IdentityContext {
  const fields: ImporterV2Field[] = [
    'deviceName',
    'hostname',
    'customer',
    'businessUnit',
    'site',
    'vendor',
    'productFamily',
    'deviceType',
    'model',
    'softwarePlatform',
  ]
  return Object.fromEntries(
    fields.map((field) => [field, effectiveText(snapshot, field)]),
  ) as ImporterV2IdentityContext
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function repairedRepeatClassification(input: {
  current: string | null
  identityKind: string
}) {
  if (input.identityKind === 'AMBIGUOUS') return 'AMBIGUOUS'
  if (input.identityKind === 'MATCH_SUGGESTED') {
    return input.current === 'AMBIGUOUS' || input.current === 'NEW'
      ? 'CHANGED'
      : input.current
  }
  if (input.identityKind === 'NEW') {
    return input.current === 'AMBIGUOUS' ? 'NEW' : input.current
  }
  return input.current
}

/**
 * Durable identity decisions are evaluated against the live provider crosswalk.
 * This matters for stale source rows that initially had no source ID, serial or
 * MAC and were corrected later in the reconciliation workspace.
 *
 * A manual identifier is never assumed to mean "new device":
 * - no live crosswalk match -> NEW
 * - one durable match -> MATCH_SUGGESTED (high confidence may auto-resolve)
 * - multiple/conflicting durable matches -> AMBIGUOUS
 * - no durable identifier after all -> INVALID
 *
 * Hostname/customer/site remain context only. They never become durable keys.
 */
export async function reconcileImporterV2ManualIdentity(batchId: string) {
  const batch = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { id: batchId },
    select: { provider: true, sourceAdapterId: true },
  })
  if (!batch) throw new Error('Importer batch was not found.')

  const rows = await prisma.importerV2WorkspaceRow.findMany({
    where: {
      batchId,
      inclusion: 'INCLUDED',
      decisions: {
        some: { field: { in: [...DURABLE_IDENTITY_FIELDS] } },
      },
    },
    select: {
      id: true,
      repeatClassification: true,
      repeatDiff: true,
      identityResolution: true,
      evaluated: true,
      decisions: {
        orderBy: { createdAt: 'asc' },
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
  })

  let repairedRowCount = 0
  let matchedExistingCount = 0
  let newCount = 0
  let ambiguousCount = 0
  let invalidCount = 0

  for (const row of rows) {
    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: 'INCLUDED',
      decisions: row.decisions,
    }).evaluated as EffectiveSnapshot
    const sourceIdentifiers = identifiers(snapshot)
    const candidates = await findImporterV2IdentityCandidates({
      provider: batch.provider,
      sourceAdapterId: batch.sourceAdapterId,
      identifiers: sourceIdentifiers,
    })
    const resolution = resolveImporterV2Identity(
      {
        provider: batch.provider,
        sourceAdapterId: batch.sourceAdapterId,
        identifiers: sourceIdentifiers,
        context: context(snapshot),
      },
      candidates,
    )
    const repeatClassification = repairedRepeatClassification({
      current: row.repeatClassification,
      identityKind: resolution.kind,
    })

    if (resolution.kind === 'MATCH_SUGGESTED') matchedExistingCount += 1
    else if (resolution.kind === 'NEW') newCount += 1
    else if (resolution.kind === 'AMBIGUOUS') ambiguousCount += 1
    else invalidCount += 1

    const changed =
      !sameJson(row.identityResolution, resolution) ||
      row.repeatClassification !== repeatClassification ||
      row.repeatDiff !== null
    if (!changed) continue

    await prisma.importerV2WorkspaceRow.update({
      where: { id: row.id },
      data: {
        identityResolution: JSON.parse(JSON.stringify(resolution)),
        repeatClassification,
        // A repeat diff was calculated for the old identity. Once an engineer
        // changes durable identity, do not reuse that diff against another
        // canonical device. Publication falls back to its conservative update
        // policy until a future import supplies a fresh repeat snapshot.
        repeatDiff: Prisma.DbNull,
        // QA fingerprints include reviewRevision. Increment it only when live
        // identity state actually changes so repeated QA refreshes are stable.
        reviewRevision: { increment: 1 },
      },
    })
    repairedRowCount += 1
  }

  return {
    repairedRowCount,
    matchedExistingCount,
    newCount,
    ambiguousCount,
    invalidCount,
  }
}
