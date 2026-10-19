import { describe, expect, it } from 'vitest'
import {
  prepareClassicCentralStacks,
} from '@/lib/aruba-classic-stack-normalization'
import {
  classicCentralObservationToNormalizedRow,
} from '@/lib/importer-v2-aruba-classic-central'
import {
  automaticImporterV2StackTopologyDecisions,
} from '@/lib/importer-v2-stack-topology'
import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'

const physical=(serial:string,stack:string,name='lab-stack-sw01',site='Example Customer - Site A'):
ClassicCentralDeviceObservation=>({
  kind:'SWITCH',raw:{
    serial,stack_id:stack,name,site,site_id:128,
    model:'6200(JL728A)',firmware_version:'10.13.1020',
  },
})

describe('Aruba Classic logical stack representation',()=>{
  it('stages one managed stack and two distinct physical member rows, not two lab-stack-sw01 Devices',()=>{
    const input=[physical('SER-A','STACK-72'),physical('SER-B','STACK-72')]
    const result=prepareClassicCentralStacks(input)
    expect(result).toMatchObject({
      physicalMembersHeldForReview:2,
      logicalStacksDetected:1,
      unresolvedStackObservationCount:0,
      reviewRowNumbers:[1,2,3],
    })
    const normalized=result.observations.map((row,index)=>
      classicCentralObservationToNormalizedRow(row,index+1,{
        customer:'Example Customer',sitesByName:{'Example Customer - Site A':'Site A'},
      }))
    expect(normalized.map(row=>row.rawValues.deviceName)).toEqual([
      'lab-stack-sw01','lab-stack-sw01 Member 1','lab-stack-sw01 Member 2',
    ])
    expect(normalized[0]).toMatchObject({
      sourceRecordKey:'aruba-classic-stack:STACK-72',
      rawValues:{
        deviceType:'Stack',sourceId:'aruba-classic-stack:STACK-72',
        serialNumber:null,macAddress:null,customer:'Example Customer',site:'Site A',
      },
    })
    expect(normalized.slice(1).map(row=>row.rawValues.serialNumber))
      .toEqual(['SER-A','SER-B'])
    expect(normalized[1].rawValues.currentFirmware).toBe('10.13.1020')

    // Uses the canonical stack topology detector already used for Auvik.
    const topology=automaticImporterV2StackTopologyDecisions({
      provider:'ARUBA',
      rows:normalized.map(row=>({
        id:String(row.rowNumber),rowNumber:row.rowNumber,
        customer:row.rawValues.customer,site:row.rawValues.site,
        sourceName:row.rawValues.deviceName,
        deviceType:row.rawValues.deviceType,
        evaluated:{rawValues:row.rawValues,proposedCanonicalValues:{}},
      })),
    })
    expect(topology.groups).toHaveLength(1)
    expect(topology.decisions.map(decision=>decision.action)).toEqual([
      'TOPOLOGY_STACK_PARENT','TOPOLOGY_STACK_MEMBER','TOPOLOGY_STACK_MEMBER',
    ])
  })

  it('does not combine members with different stack IDs even if they have the same name',()=>{
    const result=prepareClassicCentralStacks([
      physical('SERA','STACK-A'),physical('SERB','STACK-B'),
    ])
    expect(result.logicalStacksDetected).toBe(0)
    expect(result.reviewRowNumbers).toEqual([1,2])
    expect(result.unresolvedStackObservationCount).toBe(2)
  })

  it('leaves ambiguous duplicate serials or inconsistent names in review',()=>{
    const duplicate=prepareClassicCentralStacks([
      physical('SERA','STACK-A'),physical('SERA','STACK-A'),
    ])
    expect(duplicate.logicalStacksDetected).toBe(0)
    expect(duplicate.reviewRowNumbers).toEqual([1,2])
    const differentNames=prepareClassicCentralStacks([
      physical('SERA','STACK-A'),physical('SERB','STACK-A','other-name'),
    ])
    expect(differentNames.logicalStacksDetected).toBe(0)
    expect(differentNames.reviewRowNumbers).toEqual([1,2])
  })

  it('preserves original switch site and source evidence on physical members',()=>{
    const input=[physical('SERA','STACK-A'),physical('SERB','STACK-A')]
    const result=prepareClassicCentralStacks(input)
    expect(result.observations[1].raw).toMatchObject({
      site:'Example Customer - Site A',
      site_id:128,
      serial:'SERA',
      nocOrchestratorOriginalMemberName:'lab-stack-sw01',
    })
    expect(input[0].raw.name).toBe('lab-stack-sw01')
  })

  it('keeps non-stack APs and ordinary switches unmodified',()=>{
    const ap:ClassicCentralDeviceObservation={
      kind:'AP',raw:{serial:'AP1',name:'AP1',site:'Example Customer - Site A'},
    }
    const independent:ClassicCentralDeviceObservation={
      kind:'SWITCH',raw:{serial:'SW1',name:'SW1',site:'Example Customer - Site A'},
    }
    const result=prepareClassicCentralStacks([ap,independent])
    expect(result.observations).toEqual([ap,independent])
    expect(result.reviewRowNumbers).toEqual([])
  })

  it('uses explicit vendor member slots when available',()=>{
    const result=prepareClassicCentralStacks([
      {...physical('SERA','STACK-A'),raw:{...physical('SERA','STACK-A').raw,member_id:2}},
      {...physical('SERB','STACK-A'),raw:{...physical('SERB','STACK-A').raw,member_id:1}},
    ])
    expect(result.observations.map(item=>item.raw.name)).toEqual([
      'lab-stack-sw01','lab-stack-sw01 Member 1','lab-stack-sw01 Member 2',
    ])
    expect(result.observations[1].raw.serial).toBe('SERB')
    expect(result.observations[1].raw.nocOrchestratorStackPositionSource).toBe('VENDOR_SLOT')
  })
})
