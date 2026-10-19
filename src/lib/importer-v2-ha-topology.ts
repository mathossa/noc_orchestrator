import { createHash } from 'node:crypto'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import { normalizeImporterV2Identity } from '@/lib/importer-v2-identity'
import {
  IMPORTER_V2_HA_MEMBER_ACTION,
  IMPORTER_V2_HA_PARENT_ACTION,
  importerV2TopologyFromDecisions,
} from '@/lib/importer-v2-stack-topology'
import {
  importerV2WorkspaceEffectiveEvaluated,
  importerV2WorkspaceEffectiveText,
} from '@/lib/importer-v2-workspace-effective-overlay'

type DecisionLike = {
  action: string
  field: string | null
  value?: unknown
}

type EffectiveSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<
    Record<
      ImporterV2Field,
      { id?: string | null; label?: string | null } | null
    >
  >
}

export type ImporterV2HaCandidateRow = {
  id: string
  rowNumber: number
  inclusion: string
  sourceName?: string | null
  hostname?: string | null
  evaluated: unknown
  decisions: readonly DecisionLike[]
}

export type ImporterV2ConfirmedHaGroup = {
  kind: 'HA'
  groupKey: string
  parentRowNumber: number
  memberRows: Array<{
    rowNumber: number
    memberIndex: number
    sourceId: string
    name: string
  }>
  sharedIdentifiers: Array<'serialNumber' | 'macAddress'>
  source: 'ENGINEER_CONFIRMED' | 'PERSISTED_TOPOLOGY'
}

export type ImporterV2KnownHaTopology = {
  sourceGroupKey: string
  members: readonly {
    position: number
    sourceId: string | null
  }[]
}

function text(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function key(value: string | null | undefined) {
  return text(value)?.toLocaleLowerCase('en-US') ?? null
}

function snapshot(row: ImporterV2HaCandidateRow) {
  return importerV2WorkspaceEffectiveEvaluated({
    evaluated: row.evaluated,
    inclusion: row.inclusion,
    decisions: row.decisions,
  }).evaluated as EffectiveSnapshot
}

function effective(
  row: ImporterV2HaCandidateRow,
  field: ImporterV2Field,
) {
  return importerV2WorkspaceEffectiveText(snapshot(row), field)
}

function rowName(row: ImporterV2HaCandidateRow) {
  return (
    effective(row, 'deviceName') ??
    text(row.sourceName) ??
    effective(row, 'hostname') ??
    text(row.hostname) ??
    `Row #${row.rowNumber}`
  )
}

function assertSameContext(
  rows: readonly ImporterV2HaCandidateRow[],
  field: ImporterV2Field,
  label: string,
) {
  const values = rows.map((row) => key(effective(row, field)))
  if (!values[0] || values[0] !== values[1]) {
    throw new Error(
      `HA confirmation requires both rows to resolve to the same ${label}.`,
    )
  }
}

function stableHaGroupKey(provider: string, sourceIds: readonly string[]) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        provider: key(provider),
        sourceIds: [...sourceIds].sort(),
      }),
    )
    .digest('hex')
    .slice(0, 32)
  return `ha:${digest}`
}

export function validateImporterV2ConfirmedHaPair(input: {
  provider: string
  rows: readonly ImporterV2HaCandidateRow[]
}): ImporterV2ConfirmedHaGroup {
  if (input.rows.length !== 2) {
    throw new Error('Confirm HA cluster requires exactly two staged rows.')
  }
  if (input.rows.some((row) => row.inclusion !== 'INCLUDED')) {
    throw new Error('Confirm HA cluster only supports included staged rows.')
  }
  if (
    input.rows.some(
      (row) => importerV2TopologyFromDecisions(row.decisions).role !== 'DEVICE',
    )
  ) {
    throw new Error(
      'One of the selected rows already belongs to a logical topology.',
    )
  }

  assertSameContext(input.rows, 'customer', 'customer')
  const businessUnits = input.rows.map((row) =>
    key(effective(row, 'businessUnit')),
  )
  if (businessUnits[0] !== businessUnits[1]) {
    throw new Error(
      'HA confirmation requires both rows to resolve to the same subdomain.',
    )
  }
  assertSameContext(input.rows, 'site', 'site')
  assertSameContext(input.rows, 'vendor', 'vendor')
  assertSameContext(input.rows, 'deviceType', 'device type')
  assertSameContext(input.rows, 'model', 'device model')

  const members = input.rows.map((row) => {
    const sourceId = text(effective(row, 'sourceId'))
    if (!sourceId) {
      throw new Error(
        `HA member row #${row.rowNumber} requires a provider Source ID.`,
      )
    }
    const normalized = normalizeImporterV2Identity({
      sourceId,
      serialNumber: effective(row, 'serialNumber'),
      macAddress: effective(row, 'macAddress'),
    })
    return {
      row,
      sourceId,
      normalized,
      name: rowName(row),
      hasFirmware: Boolean(
        effective(row, 'currentFirmware') ??
          effective(row, 'firmwareVersion') ??
          effective(row, 'softwareVersion'),
      ),
    }
  })

  if (
    members[0].normalized.sourceId === members[1].normalized.sourceId
  ) {
    throw new Error(
      'HA members must have different provider Source IDs.',
    )
  }

  const sharedIdentifiers: Array<'serialNumber' | 'macAddress'> = []
  if (
    members[0].normalized.serialNumber &&
    members[0].normalized.serialNumber ===
      members[1].normalized.serialNumber
  ) {
    sharedIdentifiers.push('serialNumber')
  }
  if (
    members[0].normalized.macAddress &&
    members[0].normalized.macAddress === members[1].normalized.macAddress
  ) {
    sharedIdentifiers.push('macAddress')
  }
  if (sharedIdentifiers.length === 0) {
    throw new Error(
      'HA confirmation requires the selected rows to share the serial or MAC alias that caused the publication collision.',
    )
  }

  const ordered = [...members].sort(
    (left, right) =>
      Number(right.hasFirmware) - Number(left.hasFirmware) ||
      (left.normalized.sourceId ?? '').localeCompare(
        right.normalized.sourceId ?? '',
      ) ||
      left.row.rowNumber - right.row.rowNumber,
  )
  const sourceIds = ordered.map(
    (member) => member.normalized.sourceId ?? member.sourceId,
  )
  return {
    kind: 'HA',
    groupKey: stableHaGroupKey(input.provider, sourceIds),
    parentRowNumber: ordered[0].row.rowNumber,
    memberRows: ordered.map((member, index) => ({
      rowNumber: member.row.rowNumber,
      memberIndex: index + 1,
      sourceId: member.sourceId,
      name: member.name,
    })),
    sharedIdentifiers,
    source: 'ENGINEER_CONFIRMED',
  }
}

export function importerV2ConfirmedHaTopologyDecisions(input: {
  group: ImporterV2ConfirmedHaGroup
  rows: readonly ImporterV2HaCandidateRow[]
  explanation: string
  scopeToken: string
}) {
  const byNumber = new Map(input.rows.map((row) => [row.rowNumber, row]))
  return input.group.memberRows.map((member) => {
    const row = byNumber.get(member.rowNumber)
    if (!row) {
      throw new Error(
        `HA member row #${member.rowNumber} disappeared before confirmation.`,
      )
    }
    const isParent =
      member.rowNumber === input.group.parentRowNumber
    return {
      rowId: row.id,
      rowNumber: row.rowNumber,
      field: null,
      action: isParent
        ? IMPORTER_V2_HA_PARENT_ACTION
        : IMPORTER_V2_HA_MEMBER_ACTION,
      value: isParent
        ? {
            role: 'HA' as const,
            groupKey: input.group.groupKey,
            parentRowNumber: input.group.parentRowNumber,
            memberIndex: null,
            memberRows: input.group.memberRows.map((item) => ({
              rowNumber: item.rowNumber,
              memberIndex: item.memberIndex,
            })),
            source: input.group.source,
          }
        : {
            role: 'HA_MEMBER' as const,
            groupKey: input.group.groupKey,
            parentRowNumber: input.group.parentRowNumber,
            memberIndex: member.memberIndex,
            memberRows: [],
            source: input.group.source,
          },
      explanation: input.explanation,
      scopeToken: input.scopeToken,
    }
  })
}

export function automaticImporterV2KnownHaTopologyDecisions(input: {
  rows: readonly ImporterV2HaCandidateRow[]
  topologies: readonly ImporterV2KnownHaTopology[]
}) {
  const rowsBySourceId = new Map<string, ImporterV2HaCandidateRow>()
  const duplicateSourceIds = new Set<string>()
  for (const row of input.rows) {
    const sourceId = normalizeImporterV2Identity({
      sourceId: effective(row, 'sourceId'),
    }).sourceId
    if (!sourceId) continue
    if (rowsBySourceId.has(sourceId)) {
      duplicateSourceIds.add(sourceId)
      continue
    }
    rowsBySourceId.set(sourceId, row)
  }

  const groups: ImporterV2ConfirmedHaGroup[] = []
  const decisions: ReturnType<
    typeof importerV2ConfirmedHaTopologyDecisions
  > = []

  for (const topology of input.topologies) {
    const present = topology.members
      .flatMap((member) => {
        const normalizedSourceId = normalizeImporterV2Identity({
          sourceId: member.sourceId,
        }).sourceId
        if (
          !normalizedSourceId ||
          duplicateSourceIds.has(normalizedSourceId)
        ) {
          return []
        }
        const row = rowsBySourceId.get(normalizedSourceId)
        return row
          ? [
              {
                row,
                sourceId: member.sourceId!,
                memberIndex: member.position,
                name: rowName(row),
              },
            ]
          : []
      })
      .sort(
        (left, right) =>
          left.memberIndex - right.memberIndex ||
          left.row.rowNumber - right.row.rowNumber,
      )
    if (present.length === 0) continue

    const group: ImporterV2ConfirmedHaGroup = {
      kind: 'HA',
      groupKey: topology.sourceGroupKey,
      parentRowNumber: present[0].row.rowNumber,
      memberRows: present.map((member) => ({
        rowNumber: member.row.rowNumber,
        memberIndex: member.memberIndex,
        sourceId: member.sourceId,
        name: member.name,
      })),
      sharedIdentifiers: [],
      source: 'PERSISTED_TOPOLOGY',
    }
    groups.push(group)
    decisions.push(
      ...importerV2ConfirmedHaTopologyDecisions({
        group,
        rows: present.map((item) => item.row),
        explanation:
          'Reused the previously confirmed HA topology from physical member Source IDs. Member role/position is topology evidence, not active/passive identity.',
        scopeToken: `AUTO_TOPOLOGY:HA:${topology.sourceGroupKey}`,
      }),
    )
  }

  return { groups, decisions }
}
