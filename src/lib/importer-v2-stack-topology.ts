import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'

export const IMPORTER_V2_STACK_PARENT_ACTION = 'TOPOLOGY_STACK_PARENT'
export const IMPORTER_V2_STACK_MEMBER_ACTION = 'TOPOLOGY_STACK_MEMBER'

export type ImporterV2TopologyRole = 'DEVICE' | 'STACK' | 'STACK_MEMBER'

export type ImporterV2TopologyState = {
  role: ImporterV2TopologyRole
  groupKey: string | null
  parentRowNumber: number | null
  memberIndex: number | null
  memberRows: Array<{ rowNumber: number; memberIndex: number }>
  source: string | null
}

type DecisionLike = {
  action: string
  value?: unknown
}

type CanonicalTarget = { id?: string | null; label?: string } | null
type EvaluatedSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
}

export type ImporterV2StackDetectionRow = {
  id: string
  rowNumber: number
  sourceName?: string | null
  hostname?: string | null
  customer?: string | null
  businessUnit?: string | null
  site?: string | null
  deviceType?: string | null
  evaluated: unknown
}

export type ImporterV2DetectedStackGroup = {
  groupKey: string
  parentRowNumber: number
  parentName: string
  memberRows: Array<{
    rowNumber: number
    memberIndex: number
    name: string
  }>
  source: 'AUVIK_MEMBER_NAMING' | 'STACK_MEMBER_NAMING'
}

export type ImporterV2TopologyDecisionInput = {
  rowId: string
  rowNumber: number
  field: null
  action: typeof IMPORTER_V2_STACK_PARENT_ACTION | typeof IMPORTER_V2_STACK_MEMBER_ACTION
  value: ImporterV2TopologyState
  explanation: string
  scopeToken: string
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function canonical(value: string | null | undefined) {
  return text(value)?.toLocaleLowerCase('en-US') ?? null
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function snapshot(row: ImporterV2StackDetectionRow) {
  return row.evaluated as EvaluatedSnapshot
}

function effectiveField(row: ImporterV2StackDetectionRow, field: ImporterV2Field) {
  const evaluated = snapshot(row)
  return (
    text(evaluated.proposedCanonicalValues?.[field]?.label) ??
    text(evaluated.rawValues?.[field])
  )
}

function rowName(row: ImporterV2StackDetectionRow) {
  return (
    effectiveField(row, 'deviceName') ??
    text(row.sourceName) ??
    effectiveField(row, 'hostname') ??
    text(row.hostname)
  )
}

function contextKey(row: ImporterV2StackDetectionRow) {
  const customer = canonical(effectiveField(row, 'customer') ?? row.customer)
  const businessUnit = canonical(effectiveField(row, 'businessUnit') ?? row.businessUnit)
  const site = canonical(effectiveField(row, 'site') ?? row.site)
  return [customer ?? '', businessUnit ?? '', site ?? ''].join('|')
}

function deviceType(row: ImporterV2StackDetectionRow) {
  return canonical(effectiveField(row, 'deviceType') ?? row.deviceType)
}

function memberName(value: string | null) {
  if (!value) return null
  const match = /^(.*?)\s+Member\s+(\d+)$/i.exec(value)
  if (!match) return null
  const baseName = text(match[1])
  const memberIndex = Number.parseInt(match[2], 10)
  if (!baseName || !Number.isInteger(memberIndex) || memberIndex < 1) return null
  return { baseName, memberIndex }
}

function safeGroupKey(input: {
  provider: string
  parentName: string
  context: string
}) {
  return [
    canonical(input.provider) ?? 'source',
    input.context,
    canonical(input.parentName) ?? input.parentName,
  ].join('|')
}

export function detectImporterV2StackGroups(input: {
  provider: string
  rows: readonly ImporterV2StackDetectionRow[]
}): ImporterV2DetectedStackGroup[] {
  const parentIndex = new Map<string, ImporterV2StackDetectionRow[]>()
  for (const row of input.rows) {
    const name = rowName(row)
    if (!name || memberName(name)) continue
    const key = `${contextKey(row)}|${canonical(name)}`
    const items = parentIndex.get(key) ?? []
    items.push(row)
    parentIndex.set(key, items)
  }

  const groupedMembers = new Map<
    string,
    Array<{ row: ImporterV2StackDetectionRow; name: string; memberIndex: number; baseName: string }>
  >()
  for (const row of input.rows) {
    const name = rowName(row)
    const member = memberName(name)
    if (!name || !member) continue
    const key = `${contextKey(row)}|${canonical(member.baseName)}`
    const items = groupedMembers.get(key) ?? []
    items.push({ row, name, ...member })
    groupedMembers.set(key, items)
  }

  const groups: ImporterV2DetectedStackGroup[] = []
  for (const [key, members] of groupedMembers) {
    const parents = parentIndex.get(key) ?? []
    if (parents.length !== 1) continue
    const parent = parents[0]
    const parentName = rowName(parent)
    if (!parentName) continue

    // The name relationship is strong but not sufficient by itself. Require
    // the source parent to actually describe a stack so an ordinary device
    // called "x" plus another object called "x Member 1" is never collapsed.
    const parentLooksLikeStack = deviceType(parent)?.includes('stack') ?? false
    if (!parentLooksLikeStack) continue

    const byIndex = new Map<number, typeof members[number]>()
    let ambiguous = false
    for (const member of members) {
      if (byIndex.has(member.memberIndex)) {
        ambiguous = true
        break
      }
      byIndex.set(member.memberIndex, member)
    }
    if (ambiguous) continue

    const sortedMembers = [...byIndex.values()].sort(
      (left, right) => left.memberIndex - right.memberIndex || left.row.rowNumber - right.row.rowNumber,
    )
    const groupKey = safeGroupKey({
      provider: input.provider,
      parentName,
      context: contextKey(parent),
    })
    groups.push({
      groupKey,
      parentRowNumber: parent.rowNumber,
      parentName,
      memberRows: sortedMembers.map((member) => ({
        rowNumber: member.row.rowNumber,
        memberIndex: member.memberIndex,
        name: member.name,
      })),
      source:
        canonical(input.provider) === 'auvik'
          ? 'AUVIK_MEMBER_NAMING'
          : 'STACK_MEMBER_NAMING',
    })
  }

  return groups.sort((left, right) => left.parentRowNumber - right.parentRowNumber)
}

export function automaticImporterV2StackTopologyDecisions(input: {
  provider: string
  rows: readonly ImporterV2StackDetectionRow[]
}): {
  groups: ImporterV2DetectedStackGroup[]
  decisions: ImporterV2TopologyDecisionInput[]
} {
  const groups = detectImporterV2StackGroups(input)
  const rowByNumber = new Map(input.rows.map((row) => [row.rowNumber, row]))
  const decisions: ImporterV2TopologyDecisionInput[] = []

  for (const group of groups) {
    const parent = rowByNumber.get(group.parentRowNumber)
    if (!parent) continue
    const memberRows = group.memberRows.map(({ rowNumber, memberIndex }) => ({
      rowNumber,
      memberIndex,
    }))
    decisions.push({
      rowId: parent.id,
      rowNumber: parent.rowNumber,
      field: null,
      action: IMPORTER_V2_STACK_PARENT_ACTION,
      value: {
        role: 'STACK',
        groupKey: group.groupKey,
        parentRowNumber: parent.rowNumber,
        memberIndex: null,
        memberRows,
        source: group.source,
      },
      explanation: `Detected logical stack “${group.parentName}” with ${memberRows.length} physical member row(s). The stack remains the managed Device; member rows retain physical model/serial/firmware evidence.`,
      scopeToken: `AUTO_TOPOLOGY:STACK:${parent.rowNumber}`,
    })

    for (const member of group.memberRows) {
      const row = rowByNumber.get(member.rowNumber)
      if (!row) continue
      decisions.push({
        rowId: row.id,
        rowNumber: row.rowNumber,
        field: null,
        action: IMPORTER_V2_STACK_MEMBER_ACTION,
        value: {
          role: 'STACK_MEMBER',
          groupKey: group.groupKey,
          parentRowNumber: parent.rowNumber,
          memberIndex: member.memberIndex,
          memberRows: [],
          source: group.source,
        },
        explanation: `Detected ${member.name} as physical member ${member.memberIndex} of logical stack “${group.parentName}”. It will not publish as a separate managed Device.`,
        scopeToken: `AUTO_TOPOLOGY:STACK:${parent.rowNumber}:MEMBER:${member.memberIndex}`,
      })
    }
  }

  return { groups, decisions }
}

export function importerV2TopologyFromDecisions(
  decisions: readonly DecisionLike[] | undefined,
): ImporterV2TopologyState {
  for (let index = (decisions?.length ?? 0) - 1; index >= 0; index -= 1) {
    const decision = decisions?.[index]
    if (
      !decision ||
      (decision.action !== IMPORTER_V2_STACK_PARENT_ACTION &&
        decision.action !== IMPORTER_V2_STACK_MEMBER_ACTION)
    ) {
      continue
    }
    const value = object(decision.value)
    const role = value?.role
    if (role !== 'STACK' && role !== 'STACK_MEMBER') continue
    const rawMembers = Array.isArray(value.memberRows) ? value.memberRows : []
    const memberRows = rawMembers.flatMap((item) => {
      const entry = object(item)
      const rowNumber = integer(entry?.rowNumber)
      const memberIndex = integer(entry?.memberIndex)
      return rowNumber && memberIndex ? [{ rowNumber, memberIndex }] : []
    })
    return {
      role,
      groupKey: text(value.groupKey),
      parentRowNumber: integer(value.parentRowNumber),
      memberIndex: integer(value.memberIndex),
      memberRows,
      source: text(value.source),
    }
  }

  return {
    role: 'DEVICE',
    groupKey: null,
    parentRowNumber: null,
    memberIndex: null,
    memberRows: [],
    source: null,
  }
}

export function importerV2PublicationIdentityFields(input: {
  topology: ImporterV2TopologyState
  sourceId: string | null
  serialNumber: string | null
  macAddress: string | null
}) {
  if (input.topology.role !== 'STACK') {
    return {
      sourceId: input.sourceId,
      serialNumber: input.serialNumber,
      macAddress: input.macAddress,
    }
  }

  // A logical stack must not claim Member 1's copied serial/MAC as its own.
  // The provider source ID is the durable identity of the logical stack; member
  // serial/MAC values are published into DeviceTopologyMember instead.
  return {
    sourceId: input.sourceId,
    serialNumber: null,
    macAddress: null,
  }
}
