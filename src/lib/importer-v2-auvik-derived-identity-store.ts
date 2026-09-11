import { prisma } from '@/lib/prisma'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import {
  importerV2AuvikContextSupportsExistingDevice,
  importerV2DerivedAuvikDeviceSourceId,
  isImporterV2AuvikXlsxSource,
} from '@/lib/importer-v2-auvik-derived-identity'
import { importerV2TopologyFromDecisions } from '@/lib/importer-v2-stack-topology'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { reconcileImporterV2ManualIdentity } from '@/lib/importer-v2-workspace-identity-repair'

type CanonicalTarget = { id?: string | null; label?: string } | null
type EffectiveSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
}

function clean(value: string | null | undefined) {
  const result = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return result || null
}

function key(value: string | null | undefined) {
  return clean(value)?.toLocaleLowerCase('en-US') ?? null
}

function effectiveText(snapshot: EffectiveSnapshot, field: ImporterV2Field) {
  return (
    clean(snapshot.proposedCanonicalValues?.[field]?.label) ??
    clean(snapshot.rawValues?.[field])
  )
}

type PendingIdentity = {
  rowId: string
  rowNumber: number
  customer: string
  deviceName: string
  site: string | null
  model: string | null
  sourceId: string
}

/**
 * Some Auvik XLSX rows (notably APs) contain no source ID, serial or single
 * device MAC at all. For those rows only, derive a marked source identity from
 * the canonical uniqueness boundary (customer + device name).
 *
 * When an exact canonical customer/name Device already exists, require an
 * additional site or model agreement before bootstrapping that match. This is
 * a read-only lookup during staging; the crosswalk is written only by the
 * normal atomic publication transaction.
 */
export async function ensureImporterV2DerivedAuvikStandaloneIdentities(batchId: string) {
  const batch = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { id: batchId },
    select: {
      provider: true,
      sourceAdapterId: true,
      rows: {
        where: { inclusion: 'INCLUDED', publishedAt: null },
        orderBy: { rowNumber: 'asc' },
        select: {
          id: true,
          rowNumber: true,
          evaluated: true,
          decisions: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
    },
  })
  if (!batch) throw new Error('Importer batch was not found.')
  if (!isImporterV2AuvikXlsxSource(batch)) {
    return {
      appliedCount: 0,
      bootstrappedExistingCount: 0,
      repairedIdentityCount: 0,
    }
  }

  const pending: PendingIdentity[] = []
  for (const row of batch.rows) {
    const topology = importerV2TopologyFromDecisions(row.decisions)
    if (topology.role !== 'DEVICE') continue

    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: 'INCLUDED',
      decisions: row.decisions,
    }).evaluated as EffectiveSnapshot

    if (
      effectiveText(snapshot, 'sourceId') ||
      effectiveText(snapshot, 'serialNumber') ||
      effectiveText(snapshot, 'macAddress')
    ) {
      continue
    }

    const customer = effectiveText(snapshot, 'customer')
    const deviceName =
      effectiveText(snapshot, 'deviceName') ?? effectiveText(snapshot, 'hostname')
    if (!customer || !deviceName) continue

    pending.push({
      rowId: row.id,
      rowNumber: row.rowNumber,
      customer,
      deviceName,
      site: effectiveText(snapshot, 'site'),
      model: effectiveText(snapshot, 'model'),
      sourceId: importerV2DerivedAuvikDeviceSourceId({
        provider: batch.provider,
        customer,
        deviceName,
      }),
    })
  }

  if (pending.length === 0) {
    return {
      appliedCount: 0,
      bootstrappedExistingCount: 0,
      repairedIdentityCount: 0,
    }
  }

  const customerNames = [...new Set(pending.map((item) => item.customer))]
  const deviceNames = [...new Set(pending.map((item) => item.deviceName))]
  const devices = await prisma.device.findMany({
    where: {
      name: { in: deviceNames },
      customer: { name: { in: customerNames } },
    },
    select: {
      id: true,
      name: true,
      customer: { select: { name: true } },
      site: { select: { name: true } },
      deviceModel: { select: { model: true } },
    },
  })

  const existingByContext = new Map<string, typeof devices>()
  for (const device of devices) {
    const customerKey = key(device.customer.name)
    const nameKey = key(device.name)
    if (!customerKey || !nameKey) continue
    const contextKey = `${customerKey}|${nameKey}`
    existingByContext.set(contextKey, [
      ...(existingByContext.get(contextKey) ?? []),
      device,
    ])
  }

  const decisions: Array<{
    batchId: string
    rowId: string
    rowNumber: number
    field: string | null
    action: string
    value: unknown
    explanation: string
    scopeToken: string
    actorUserId: null
  }> = []
  let bootstrappedExistingCount = 0

  for (const item of pending) {
    decisions.push({
      batchId,
      rowId: item.rowId,
      rowNumber: item.rowNumber,
      field: 'sourceId',
      action: 'SET_FIELD',
      value: { id: null, label: item.sourceId },
      explanation:
        'Auvik XLSX supplied no per-device Source ID, serial, or single device MAC. A deterministic derived source key was added from resolved customer + device name so this source row can be remembered across repeat imports.',
      scopeToken: `AUTO_AUVIK:DERIVED_DEVICE_SOURCE:${item.rowNumber}`,
      actorUserId: null,
    })

    const contextKey = `${key(item.customer)}|${key(item.deviceName)}`
    const candidates = existingByContext.get(contextKey) ?? []
    if (candidates.length !== 1) continue
    const candidate = candidates[0]
    if (
      !importerV2AuvikContextSupportsExistingDevice({
        sourceSite: item.site,
        sourceModel: item.model,
        candidateSite: candidate.site?.name ?? null,
        candidateModel: candidate.deviceModel.model,
      })
    ) {
      continue
    }

    decisions.push({
      batchId,
      rowId: item.rowId,
      rowNumber: item.rowNumber,
      field: null,
      action: 'IDENTITY_RESOLUTION',
      value: {
        kind: 'MANUAL_OVERRIDE',
        canonicalDeviceId: candidate.id,
        source: 'AUTO_AUVIK_CONTEXT',
      },
      explanation:
        'Auvik supplied no durable device identifier. The row was matched to the one canonical Device with the same resolved customer + device name and agreeing site/model context. Publication will persist the derived source crosswalk for future imports.',
      scopeToken: `AUTO_AUVIK:BOOTSTRAP_EXISTING:${item.rowNumber}`,
      actorUserId: null,
    })
    bootstrappedExistingCount += 1
  }

  await prisma.importerV2WorkspaceDecision.createMany({
    data: decisions.map((decision) => ({
      ...decision,
      value: JSON.parse(JSON.stringify(decision.value)),
    })),
  })
  await prisma.importerV2WorkspaceRow.updateMany({
    where: { id: { in: pending.map((item) => item.rowId) } },
    data: { reviewRevision: { increment: 1 } },
  })

  const repaired = await reconcileImporterV2ManualIdentity(batchId)
  return {
    appliedCount: pending.length,
    bootstrappedExistingCount,
    repairedIdentityCount: repaired.repairedRowCount,
  }
}
