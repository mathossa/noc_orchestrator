import type {
  ClassicCentralDeviceObservation,
  ClassicCentralSwitchStack,
} from '@/lib/aruba-classic-central-api-client'

type StackSummary = {
  stackCount: number
  stacksWithMembers: number
  stacksWithoutMembers: number
  stacksWithSelectedMembers: number
  physicalMemberCount: number
  selectedPhysicalMemberCount: number
  examples: Array<{
    name: string
    stackType: string | null
    memberCount: number
    selectedMemberCount: number
  }>
}

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

/**
 * Diagnostic correlation is by provider stack_id, NOT by arbitrary stack name.
 * "Monitoring only" switch stacks are observable separately, but we cannot
 * assign their physical site or serial from a configuration group or name.
 */
export function summarizeClassicCentralSwitchStacks(
  stacks: readonly ClassicCentralSwitchStack[],
  fetched: readonly ClassicCentralDeviceObservation[],
  selected: readonly ClassicCentralDeviceObservation[],
): StackSummary {
  const switches = fetched.filter(row => row.kind === 'SWITCH')
  const selectedSwitches = new Set(selected
    .filter(row => row.kind === 'SWITCH')
    .flatMap(row => {
      const serial = clean(row.raw.serial)
      return serial ? [serial] : []
    }))
  const matched = stacks.map(stack => {
    const id = clean(stack.id)
    const members = switches.filter(row => clean(row.raw.stack_id) === id)
    const selectedMemberCount = members.filter(
      row => selectedSwitches.has(clean(row.raw.serial) ?? ''),
    ).length
    return {
      name: clean(stack.name) ?? '(unnamed stack)',
      stackType: clean(stack.switch_type),
      memberCount: members.length,
      selectedMemberCount,
    }
  })
  return {
    stackCount: matched.length,
    stacksWithMembers: matched.filter(stack => stack.memberCount > 0).length,
    stacksWithoutMembers: matched.filter(stack => stack.memberCount === 0).length,
    stacksWithSelectedMembers: matched.filter(stack => stack.selectedMemberCount > 0).length,
    physicalMemberCount: matched.reduce((count, stack) => count + stack.memberCount, 0),
    selectedPhysicalMemberCount: matched.reduce(
      (count, stack) => count + stack.selectedMemberCount, 0,
    ),
    examples: matched.slice(0, 8),
  }
}
