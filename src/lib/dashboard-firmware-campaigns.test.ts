import { describe, expect, it } from 'vitest'
import { buildFirmwareCampaigns, countFirmwareCampaigns } from './dashboard-firmware-campaigns'
import type { WorkPackageFinding } from './dashboard-work-packages'

function finding(id: string, options: Partial<WorkPackageFinding> = {}): WorkPackageFinding {
  return {
    deviceId: id,
    deviceName: 'FG-' + id,
    customer: { id: 'customer-' + id, name: 'Customer ' + id },
    site: { id: 'site-' + id, name: 'Site ' + id },
    deviceTypeId: 'firewall',
    vendor: { id: 'fortinet', name: 'Fortinet' },
    model: { id: 'fgt-60f', name: 'FortiGate 60F' },
    firmwareKey: 'release-' + id,
    currentFirmwareVersion: '7.4.5',
    currentPlatform: 'FortiOS',
    currentTrain: '7.4',
    targetVersion: '7.4.13',
    targetPlatform: 'FortiOS',
    targetTrain: '7.4',
    status: 'UPDATE_REQUIRED',
    compliance: 'BELOW_MINIMUM',
    reason: 'Below minimum policy',
    managementContractId: 'proactive',
    plan: null,
    ...options,
  }
}

describe('firmware remediation campaigns', () => {
  it('consolidates many customer and model findings into one campaign with unique devices', () => {
    const values = [
      finding('a'),
      finding('b', { model: { id: 'fgt-200f', name: 'FortiGate 200F' } }),
      finding('c', { currentFirmwareVersion: '7.4.11', firmwareKey: 'release-new' }),
      finding('a'),
    ]
    const campaigns = buildFirmwareCampaigns(values)
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0]).toMatchObject({
      vendor: { name: 'Fortinet' },
      sourceTrain: '7.4',
      targetVersion: '7.4.13',
      deviceCount: 3,
      customerCount: 3,
    })
    expect(campaigns[0].releases.map((r) => r.version)).toEqual(['7.4.5', '7.4.11'])
    expect(campaigns[0].releases.map((r) => r.deviceCount)).toEqual([2, 1])
    expect(countFirmwareCampaigns(campaigns).devices).toBe(3)
  })

  it('keeps different source trains, targets, platforms and vendors separate', () => {
    const data = [
      finding('a'),
      finding('b', { currentTrain: '7.2', currentFirmwareVersion: '7.2.9' }),
      finding('c', { targetVersion: '7.4.12' }),
      finding('d', { targetPlatform: 'FortiOS VM' }),
      finding('e', { vendor: { id: 'another', name: 'Other' } }),
    ]
    expect(buildFirmwareCampaigns(data)).toHaveLength(5)
  })

  it('prioritizes catalog-blocked attention over required, accepted/recommended and unknown', () => {
    const campaigns = buildFirmwareCampaigns([
      finding('required'),
      finding('blocked', { currentTrain: '7.2', status: 'CRITICAL_ATTENTION', compliance: 'BLOCKED_RELEASE' }),
      finding('recommended', { currentTrain: '7.6', status: 'UPDATE_RECOMMENDED', compliance: 'ACCEPTED' }),
      finding('unknown', { currentTrain: '7.0', status: 'UNKNOWN', compliance: 'NO_POLICY' }),
    ])
    expect(campaigns.map((c) => c.severity)).toEqual(['CRITICAL', 'REQUIRED', 'RECOMMENDED', 'REVIEW'])
    expect(countFirmwareCampaigns(campaigns)).toMatchObject({
      criticalDevices: 1, updateRequiredDevices: 1,
      recommendedDevices: 1, reviewDevices: 1,
    })
  })

  it('never treats an accepted release as a confirmed CVE exposure', () => {
    const groups = buildFirmwareCampaigns([
      finding('a', { status: 'UPDATE_RECOMMENDED', compliance: 'ACCEPTED' }),
    ])
    expect(groups[0].severity).toBe('RECOMMENDED')
    expect(groups[0].releases[0].acceptedCount).toBe(1)
    expect(groups[0].reason).not.toMatch(/CVE|kwetsbaarheid/i)
  })

  it('does not count a completed current release as outstanding', () => {
    const groups = buildFirmwareCampaigns([
      finding('done', { status: 'CURRENT', currentFirmwareVersion: '7.4.13', plan: { id: 'plan', state: 'SCHEDULED' } }),
      finding('old', { status: 'UPDATE_REQUIRED' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].deviceCount).toBe(1)
    expect(groups[0].deviceIds).toEqual(['old'])
  })

  it('shows workflow approval as a separate status without clearing technical findings', () => {
    const groups = buildFirmwareCampaigns([
      finding('a', { status: 'CRITICAL_ATTENTION', plan: { id: 'plan-1', state: 'AWAITING_CUSTOMER' } }),
    ])
    expect(groups[0]).toMatchObject({ deviceCount: 1, criticalCount: 1, awaitingCustomerCount: 1 })
  })

  it('preserves all 8,000 device IDs while displaying a small release campaign list', () => {
    const rows = Array.from({ length: 8000 }, (_, index) =>
      finding(String(index), {
        customer: { id: 'customer-' + Math.floor(index / 10), name: 'Customer ' + Math.floor(index / 10) },
        site: { id: 'site-' + index, name: 'Site ' + index },
      }),
    )
    const campaigns = buildFirmwareCampaigns(rows)
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].deviceCount).toBe(8000)
    expect(campaigns[0].customerCount).toBe(800)
    expect(campaigns[0].deviceIds).toHaveLength(8000)
  })
})
