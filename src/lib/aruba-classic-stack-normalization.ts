import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'

function clean(value: unknown): string | null {
  if (typeof value === 'string') return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
  return null
}
function serial(row: ClassicCentralDeviceObservation) {
  return clean(row.raw.serial) ?? clean(row.raw.serial_number) ??
    clean(row.raw.serialNumber)
}
function stackId(row: ClassicCentralDeviceObservation) {
  if (row.kind !== 'SWITCH') return null
  return clean(row.raw.stack_id) ?? clean(row.raw.stackId)
}
function stackName(row: ClassicCentralDeviceObservation) {
  return clean(row.raw.name) ?? clean(row.raw.hostname) ?? clean(row.raw.device_name)
}
function slot(row: ClassicCentralDeviceObservation) {
  for (const field of ['member_id', 'member_index', 'member_number', 'stack_member_id'] as const) {
    const value = row.raw[field]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
    if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value.trim())) {
      const numeric = Number(value.trim())
      if (Number.isSafeInteger(numeric)) return numeric
    }
  }
  return null
}

/** Observations representing a physical stack MUST NOT be published as
 * distinct logical devices. Construct a synthetic, source-identified logical
 * parent and named physical member rows for the existing Importer v2 stack
 * topology engine. The original member serial/model/firmware remains intact.
 */
export type ClassicCentralPreparedStacks = {
  observations: ClassicCentralDeviceObservation[]
  /** Staged positions, one-based, reserved for human topology review. */
  reviewRowNumbers: number[]
  physicalMembersHeldForReview: number
  logicalStacksDetected: number
  unresolvedStackObservationCount: number
}

export function prepareClassicCentralStacks(
  observations: readonly ClassicCentralDeviceObservation[],
): ClassicCentralPreparedStacks {
  const grouped = new Map<string, Array<{index:number;row:ClassicCentralDeviceObservation}>>()
  observations.forEach((row,index) => {
    const id = stackId(row)
    if (!id) return
    grouped.set(id, [...(grouped.get(id) ?? []), {index,row}])
  })

  const parents = new Map<number,{
    parent: ClassicCentralDeviceObservation
    members: ClassicCentralDeviceObservation[]
  }>()
  const covered = new Set<number>()
  let logicalStacksDetected = 0

  for (const [id, group] of grouped) {
    if (group.length < 2) continue
    const names = [...new Set(group.map(item => stackName(item.row)))]
    const serials = group.map(item => serial(item.row))
    const durableSerials = serials.every(Boolean) &&
      new Set(serials.map(value => value!.toUpperCase())).size === group.length
    // A stack_id groups physical hardware, but does not prove the logical
    // name when the members disagree. Leave ambiguous groups for review.
    if (names.length !== 1 || !names[0] || !durableSerials) continue
    const name = names[0]
    const explicitSlots = group.map(item => slot(item.row))
    const reliableSlots = explicitSlots.every(item => item !== null) &&
      new Set(explicitSlots).size === group.length
    const ordered = [...group].sort((a,b) => reliableSlots
      ? (slot(a.row)! - slot(b.row)!)
      : serial(a.row)!.localeCompare(serial(b.row)!))
    const firmwareVersions = [...new Set(group.map(item =>
      clean(item.row.raw.firmware_version) ?? clean(item.row.raw.firmwareVersion) ??
      clean(item.row.raw.version),
    ))]
    const models = [...new Set(group.map(item => clean(item.row.raw.model)))]
    const first = ordered[0].row
    const parent:ClassicCentralDeviceObservation = {
      kind:'SWITCH',
      raw:{
        name,
        serial:null,
        macaddr:null,
        hostname:name,
        site:first.raw.site,
        site_id:first.raw.site_id ?? null,
        model:models.length===1?models[0]:null,
        firmware_version:firmwareVersions.length===1?firmwareVersions[0]:null,
        stack_id:id,
        nocOrchestratorStackParent:true,
        nocOrchestratorStackSourceId:`aruba-classic-stack:${id}`,
        nocOrchestratorPhysicalMemberCount:group.length,
        nocOrchestratorStackPositionSource:reliableSlots?
          'VENDOR_SLOT':'SERIAL_ORDER_REQUIRES_REVIEW',
      },
    }
    const members=ordered.map((item,index):ClassicCentralDeviceObservation=>({
      ...item.row,
      raw:{
        ...item.row.raw,
        name:`${name} Member ${reliableSlots?slot(item.row)!:index+1}`,
        nocOrchestratorOriginalMemberName:stackName(item.row),
        nocOrchestratorStackMember:true,
        nocOrchestratorStackPositionSource:reliableSlots?
          'VENDOR_SLOT':'SERIAL_ORDER_REQUIRES_REVIEW',
      },
    }))
    parents.set(Math.min(...group.map(item=>item.index)),{parent,members})
    for(const item of group)covered.add(item.index)
    logicalStacksDetected += 1
  }
  const prepared: ClassicCentralDeviceObservation[]=[]
  const reviewRowNumbers:number[]=[]
  let physicalMembersHeldForReview=0
  let unresolvedStackObservationCount=0
  observations.forEach((item,index)=>{
    const detected=parents.get(index)
    if(detected){
      reviewRowNumbers.push(prepared.length+1)
      prepared.push(detected.parent)
      for(const member of detected.members){
        reviewRowNumbers.push(prepared.length+1)
        prepared.push(member)
        physicalMembersHeldForReview++
      }
    } else if(!covered.has(index)){
      if(stackId(item)){
        reviewRowNumbers.push(prepared.length+1)
        physicalMembersHeldForReview++
        unresolvedStackObservationCount++
      }
      prepared.push(item)
    }
  })
  return {
    observations:prepared,
    reviewRowNumbers,
    physicalMembersHeldForReview,
    logicalStacksDetected,
    unresolvedStackObservationCount,
  }
}
