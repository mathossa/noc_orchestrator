import { describe, expect, it } from 'vitest'
import type {
  DeviceChoice,
  PlanTarget,
  PreviewTarget,
} from './planning-client'
import {
  canConfirmProposedSchedule,
  commonSwitchAndAccessPointTypeIds,
  groupPlanTargets,
  groupPreviewTargets,
  groupScopeDevices,
  proposalDraftChanged,
  resolveSiteScopeDevices,
  toggleDeviceRecord,
  toggleSelection,
} from './planning-client'

function device(
  id: string,
  {
    customerId = 'customer-a',
    customerName = 'Customer A',
    siteId = 'site-a',
    siteName = 'Amsterdam',
    deviceTypeId = 'type-switch',
    deviceTypeName = 'Switches',
    modelId = 'model-c9300',
    modelName = 'C9300',
  }: Partial<{
    customerId: string
    customerName: string
    siteId: string
    siteName: string
    deviceTypeId: string
    deviceTypeName: string
    modelId: string
    modelName: string
  }> = {},
): DeviceChoice {
  return {
    id,
    name: id.toUpperCase(),
    customerId,
    customer: { id: customerId, name: customerName },
    site: { id: siteId, name: siteName },
    deviceModelId: modelId,
    deviceModel: {
      id: modelId,
      model: modelName,
      vendor: { id: 'vendor-cisco', name: 'Cisco' },
      deviceType: {
        id: deviceTypeId,
        code: deviceTypeId,
        name: deviceTypeName,
        isActive: true,
      },
    },
    firmwareCompliance: { recommendation: 'UPDATE_REQUIRED' },
    currentFirmwareRelease: { id: 'release-current', version: '17.12.5' },
    currentFirmwareNormalizedVersion: '17.12.5',
    currentFirmwareRawVersion: '17.12.5',
  }
}

function previewTarget(
  id: string,
  overrides: Partial<PreviewTarget> = {},
): PreviewTarget {
  return {
    deviceId: id,
    deviceName: id.toUpperCase(),
    customerId: 'customer-a',
    customerName: 'Customer A',
    siteId: 'site-a',
    siteName: 'Amsterdam',
    deviceModelId: 'model-c9300',
    deviceModelName: 'C9300',
    disposition: 'INCLUDED',
    detail: 'Ready',
    activePlanId: null,
    effectiveExceptionId: null,
    effectiveExceptionReason: null,
    exceptionOverride: false,
    recommendation: 'UPDATE_REQUIRED',
    observedFirmwareVersion: '17.12.5',
    targetFirmwareReleaseId: 'release-target',
    targetVersion: '17.15.5',
    targetPlatform: 'IOS XE',
    targetVariant: null,
    targetImageCode: null,
    ...overrides,
  }
}

function planTarget(id: string): PlanTarget {
  return {
    snapshot: {
      id: `target-${id}`,
      deviceId: id,
      deviceName: id.toUpperCase(),
      customerId: 'customer-a',
      customerName: 'Customer A',
      siteId: 'site-a',
      siteName: 'Amsterdam',
      deviceModelId: 'model-c9300',
      deviceModelName: 'C9300',
      observedFirmwareVersion: '17.12.5',
      observedFirmwareRawVersion: null,
      observedAt: '2026-09-20T12:00:00.000Z',
      policyScope: 'SITE',
      policyTrackName: 'Stable',
      recommendation: 'UPDATE_REQUIRED',
      preferredTargetVersion: '17.15.5',
      targetFirmwareReleaseId: 'release-target',
      targetVersion: '17.15.5',
      targetLogicalVersion: '17.15.5',
      targetPlatform: 'IOS XE',
      targetVariant: null,
      targetImageCode: null,
      compatibilityStatus: 'RESOLVED',
      exceptionOverride: false,
      exceptionSnapshot: null,
      upgradeCapability: 'UNKNOWN',
    },
    staleness: { stale: false, reasons: [] },
    activeException: null,
  }
}

describe('plan-centric planning helpers', () => {
  it('supports multiple selected customers/sites without replacing earlier selections', () => {
    expect(toggleSelection([], 'customer-a')).toEqual(['customer-a'])
    expect(toggleSelection(['customer-a'], 'customer-b')).toEqual([
      'customer-a',
      'customer-b',
    ])
    expect(toggleSelection(['site-a', 'site-b'], 'site-a')).toEqual([
      'site-b',
    ])
  })

  it('retains arbitrary individual-device selections independently of list pages', () => {
    const first = device('device-one')
    const second = device('device-two')
    const selected = toggleDeviceRecord(
      toggleDeviceRecord({}, first),
      second,
    )
    expect(Object.keys(selected).sort()).toEqual([
      'device-one',
      'device-two',
    ])
    expect(toggleDeviceRecord(selected, first)).not.toHaveProperty(
      'device-one',
    )
  })

  it('uses canonical DeviceType IDs for the switch + access-point convenience', () => {
    expect(
      commonSwitchAndAccessPointTypeIds([
        { id: 'sw', code: 'NETWORK_SWITCH', name: 'Switches', isActive: true },
        { id: 'ap', code: 'WIRELESS_AP', name: 'Access points', isActive: true },
        { id: 'fw', code: 'FIREWALL', name: 'Firewalls', isActive: true },
      ]),
    ).toEqual(['sw', 'ap'])
  })

  it('resolves selected sites/types through one unpaginated planning-candidate request', async () => {
    const requested: Array<{ url: string; init?: RequestInit }> = []
    const candidates = Array.from({ length: 125 }, (_, index) =>
      device(`device-${String(index + 1).padStart(3, '0')}`),
    )
    const requester = async <T>(
      url: string,
      init?: RequestInit,
    ): Promise<T> => {
      requested.push({ url, init })
      return { data: candidates } as unknown as T
    }

    const result = await resolveSiteScopeDevices(
      ['site-a', 'site-b'],
      ['type-switch', 'type-ap'],
      requester,
    )

    expect(requested).toHaveLength(1)
    expect(requested[0].url).toBe('/api/v1/firmware-work-plans/candidates')
    expect(requested[0].init?.method).toBe('POST')
    expect(JSON.parse(String(requested[0].init?.body))).toEqual({
      siteIds: ['site-a', 'site-b'],
      deviceTypeIds: ['type-switch', 'type-ap'],
    })
    expect(result).toHaveLength(125)
    expect(result[0].id).toBe('device-001')
    expect(result[124].id).toBe('device-125')
  })

  it('groups resolved scope by customer, site, canonical type and model', () => {
    const groups = groupScopeDevices([
      device('a-1'),
      device('a-2'),
      device('a-ap', {
        deviceTypeId: 'type-ap',
        deviceTypeName: 'Access points',
        modelId: 'model-c9120',
        modelName: 'C9120',
      }),
      device('b-1', {
        customerId: 'customer-b',
        customerName: 'Customer B',
        siteId: 'site-b',
        siteName: 'Utrecht',
      }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].sites[0].deviceTypes).toHaveLength(2)
    expect(
      groups[0].sites[0].deviceTypes.find(
        (type) => type.deviceTypeId === 'type-switch',
      )?.count,
    ).toBe(2)
    expect(groups[1].customerName).toBe('Customer B')
  })

  it('groups previews without hiding exclusion/review dispositions', () => {
    const groups = groupPreviewTargets([
      previewTarget('one'),
      previewTarget('two'),
      previewTarget('three', {
        disposition: 'ACTIVE_EXCEPTION',
        effectiveExceptionId: 'exception-1',
      }),
    ])

    expect(groups).toHaveLength(2)
    expect(
      groups.find((group) => group.disposition === 'INCLUDED')?.count,
    ).toBe(2)
    expect(
      groups.find((group) => group.disposition === 'ACTIVE_EXCEPTION')?.count,
    ).toBe(1)
  })

  it('groups immutable historical targets by customer/site/model and exact firmware change', () => {
    const groups = groupPlanTargets([planTarget('one'), planTarget('two')])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    expect(groups[0].observedVersion).toBe('17.12.5')
    expect(groups[0].targetVersion).toBe('17.15.5')
  })

  it('detects a changed proposed date/reference so scheduling must wait for the audited amendment', () => {
    const stored = '2026-10-14T20:00:00.000Z'
    const storedLocal = (() => {
      const parsed = new Date(stored)
      const pad = (value: number) => String(value).padStart(2, '0')
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
    })()

    expect(
      proposalDraftChanged(stored, 'MW-100', storedLocal, 'MW-100'),
    ).toBe(false)
    expect(
      proposalDraftChanged(stored, 'MW-100', '2026-10-15T22:00', 'MW-100'),
    ).toBe(true)
    expect(
      proposalDraftChanged(stored, 'MW-100', storedLocal, 'MW-101'),
    ).toBe(true)
  })

  it('offers the stored-proposal schedule path only where the workflow supports it', () => {
    expect(
      canConfirmProposedSchedule(
        'AWAITING_CUSTOMER',
        '2026-10-14T20:00:00.000Z',
      ),
    ).toBe(true)
    expect(
      canConfirmProposedSchedule(
        'APPROVED',
        '2026-10-14T20:00:00.000Z',
      ),
    ).toBe(true)
    expect(canConfirmProposedSchedule('AWAITING_CUSTOMER', null)).toBe(false)
    expect(
      canConfirmProposedSchedule('PROPOSED', '2026-10-14T20:00:00.000Z'),
    ).toBe(false)
  })
})
