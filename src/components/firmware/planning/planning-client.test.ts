import { describe, expect, it } from 'vitest'
import type {
  DeviceChoice,
  DevicePayload,
  DeviceReferences,
  PlanTarget,
  PreviewTarget,
} from './planning-client'
import {
  canConfirmProposedSchedule,
  commonSwitchAndAccessPointTypeIds,
  groupPlanTargets,
  groupPreviewTargets,
  groupScopeDevices,
  resolveSiteScopeDevices,
  siteScopeQueries,
  toggleSelection,
} from './planning-client'

const references: DeviceReferences = {
  customers: [],
  sites: [],
  models: [],
  vendors: [],
  deviceTypes: [],
}

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

function payload(
  data: DeviceChoice[],
  page: number,
  totalPages: number,
): DevicePayload {
  return {
    data,
    meta: {
      ...references,
      pagination: {
        page,
        pageSize: 100,
        total: totalPages,
        totalPages,
      },
    },
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

  it('uses canonical DeviceType IDs for the switch + access-point convenience', () => {
    expect(
      commonSwitchAndAccessPointTypeIds([
        { id: 'sw', code: 'NETWORK_SWITCH', name: 'Switches', isActive: true },
        { id: 'ap', code: 'WIRELESS_AP', name: 'Access points', isActive: true },
        { id: 'fw', code: 'FIREWALL', name: 'Firewalls', isActive: true },
      ]),
    ).toEqual(['sw', 'ap'])
  })

  it('creates one server-backed query for every selected site/device-type pair', () => {
    const urls = siteScopeQueries(['site-b', 'site-a'], ['ap', 'switch'])
    expect(urls).toHaveLength(4)
    expect(urls.every((url) => url.includes('pageSize=100'))).toBe(true)
    expect(urls.some((url) => url.includes('site=site-a') && url.includes('deviceType=ap'))).toBe(true)
    expect(urls.some((url) => url.includes('site=site-b') && url.includes('deviceType=switch'))).toBe(true)
  })

  it('enumerates every device API page instead of silently using page one', async () => {
    const requested: string[] = []
    const requester = async <T>(url: string): Promise<T> => {
      requested.push(url)
      const page = Number(new URL(url, 'http://test.local').searchParams.get('page'))
      const rows =
        page === 1
          ? [device('device-1')]
          : page === 2
            ? [device('device-2')]
            : [device('device-3')]
      return payload(rows, page, 3) as T
    }

    const result = await resolveSiteScopeDevices(
      ['site-a'],
      ['type-switch'],
      requester,
    )

    expect(requested).toHaveLength(3)
    expect(requested.some((url) => url.includes('page=2'))).toBe(true)
    expect(requested.some((url) => url.includes('page=3'))).toBe(true)
    expect(result.map((row) => row.id)).toEqual([
      'device-1',
      'device-2',
      'device-3',
    ])
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
