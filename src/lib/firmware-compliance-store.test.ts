import { beforeEach, describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'
import { policy, release } from './test-fixtures/firmware-compliance'
const mocks = vi.hoisted(() => ({
  devices: vi.fn(),
  policies: vi.fn(),
  releases: vi.fn(),
  rules: vi.fn(),
  overrides: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: { findMany: mocks.devices },
    firmwarePolicy: { findMany: mocks.policies },
    firmwareRelease: { findMany: mocks.releases },
    firmwareCompatibilityRule: { findMany: mocks.rules },
    firmwareCompatibilityOverride: { findMany: mocks.overrides },
  },
}))
import {
  resolveFirmwareComplianceBatch,
  resolveFirmwareComplianceForDevice,
} from './firmware-compliance-store'
const at = new Date('2026-09-01T00:00:00Z')
function device(id = 'device') {
  return {
    id,
    customerId: 'customer',
    siteId: 'site',
    deviceModelId: 'model',
    currentFirmwareReleaseId: '17.12.5',
    currentFirmwareRawVersion: null,
    deviceModel: {
      id: 'model',
      vendorId: 'synthetic-vendor',
      familyId: 'family',
    },
  }
}
function rule(overrides = {}) {
  return {
    id: 'rule',
    vendorId: 'synthetic-vendor',
    deviceModelId: 'model',
    deviceModelFamilyId: null,
    platform: 'IOS XE',
    firmwareTrainId: null,
    logicalVersion: null,
    firmwareReleaseId: null,
    imageCode: null,
    decision: 'ALLOW',
    sourceType: 'CONFIGURED_RULE',
    explanation: 'Synthetic supported platform',
    isActive: true,
    validFrom: null,
    validUntil: null,
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.devices.mockResolvedValue([device()])
  mocks.policies.mockResolvedValue([policy()])
  mocks.releases.mockResolvedValue([release('17.12.5'), release('17.15.5')])
  mocks.rules.mockResolvedValue([rule()])
  mocks.overrides.mockResolvedValue([])
})
describe('batch firmware compliance integration', () => {
  it.each([
    [{ deviceId: 'device' }, 'DEVICE'],
    [{ siteId: 'site' }, 'SITE'],
    [{ customerId: 'customer' }, 'CUSTOMER'],
    [{}, 'MODEL'],
    [{ deviceModelId: null, deviceModelFamilyId: 'family' }, 'FAMILY'],
  ])('reuses central policy inheritance: %s -> %s', async (scope, expected) => {
    mocks.policies.mockResolvedValue([policy({ id: 'selected', ...scope })])
    const value = await resolveFirmwareComplianceForDevice('device', at)
    expect(value).toMatchObject({
      compliance: 'ACCEPTED',
      recommendation: 'UPDATE_RECOMMENDED',
      policySource: { scope: expected },
    })
  })
  it('customer/site/device overrides beat family and model without using current platform', async () => {
    mocks.policies.mockResolvedValue([
      policy({
        id: 'family',
        deviceModelId: null,
        deviceModelFamilyId: 'family',
      }),
      policy(),
      policy({ id: 'customer', customerId: 'customer' }),
      policy({ id: 'site', siteId: 'site' }),
      policy({
        id: 'device',
        deviceId: 'device',
        targetFirmwareReleaseId: '17.12.5',
      }),
      policy({
        id: 'future',
        deviceId: 'device',
        policyVersion: 2,
        effectiveFrom: '2027-01-01T00:00:00Z',
      }),
    ])
    expect(
      await resolveFirmwareComplianceForDevice('device', at),
    ).toMatchObject({
      compliance: 'PREFERRED',
      policySource: { policyId: 'device' },
    })
  })
  it('uses family compatibility and an audited #57 override', async () => {
    mocks.rules.mockResolvedValue([
      rule({
        deviceModelId: null,
        deviceModelFamilyId: 'family',
        decision: 'DENY',
      }),
    ])
    expect(
      (await resolveFirmwareComplianceForDevice('device', at)).compliance,
    ).toBe('INCOMPATIBLE')
    mocks.overrides.mockResolvedValue(
      ['17.12.5', '17.15.5'].map((firmwareReleaseId) => ({
        id: `override-${firmwareReleaseId}`,
        deviceModelId: 'model',
        firmwareReleaseId,
        decision: 'ALLOW',
        reason: 'Synthetic audited override',
        version: 1,
        isActive: true,
        createdAt: at,
      })),
    )
    expect(
      await resolveFirmwareComplianceForDevice('device', at),
    ).toMatchObject({
      compliance: 'ACCEPTED',
      currentCompatibility: { provenance: { kind: 'MANUAL_OVERRIDE' } },
    })
  })
  it('preserves #57 image ambiguity', async () => {
    mocks.releases.mockResolvedValue([
      release('17.12.5'),
      release(),
      release('17.15.5a', { logicalVersion: '17.15.5', variant: 'a' }),
    ])
    expect(
      await resolveFirmwareComplianceForDevice('device', at),
    ).toMatchObject({
      compliance: 'COMPATIBILITY_UNRESOLVED',
      targetCompatibility: { status: 'AMBIGUOUS' },
      resolvedTarget: null,
    })
  })
  it('moving policy targets only explicitly eligible train releases', async () => {
    mocks.policies.mockResolvedValue([
      policy({
        policyMode: 'LATEST_APPROVED_IN_TRAIN',
        firmwareTrainId: 'train',
        minimumFirmwareReleaseId: null,
        targetFirmwareReleaseId: null,
      }),
    ])
    mocks.releases.mockResolvedValue([
      release('17.12.5'),
      release('17.15.5'),
      release('17.16.1', {
        policyEligibility: 'NOT_EVALUATED',
        catalogState: 'OBSERVED',
      }),
    ])
    expect(
      await resolveFirmwareComplianceForDevice('device', at),
    ).toMatchObject({
      preferredTarget: { version: '17.15.5' },
      compliance: 'OUTSIDE_RANGE',
    })
  })
  it.each(['RESOLVED', 'UNKNOWN', 'AMBIGUOUS', 'INCOMPATIBLE'])(
    'cross-platform #57 result %s controls migration recommendation',
    async (status) => {
      mocks.devices.mockResolvedValue([
        { ...device(), currentFirmwareReleaseId: '8.10.0' },
      ])
      mocks.policies.mockResolvedValue([
        policy({
          policyMode: 'EXACT',
          desiredPlatform: 'AOS-10',
          minimumFirmwareReleaseId: null,
          targetFirmwareReleaseId: '10.7.0',
        }),
      ])
      const releases = [
        release('8.10.0', { platform: 'AOS-8' }),
        release('10.7.0', { platform: 'AOS-10' }),
      ]
      if (status === 'AMBIGUOUS')
        releases.push(
          release('10.7.0a', {
            platform: 'AOS-10',
            logicalVersion: '10.7.0',
            variant: 'a',
          }),
        )
      mocks.releases.mockResolvedValue(releases)
      const rules = [rule({ platform: 'AOS-8', sourceType: 'CATALOG' })]
      if (status !== 'UNKNOWN')
        rules.push(
          rule({
            id: 'target',
            platform: 'AOS-10',
            sourceType: 'CATALOG',
            decision: status === 'INCOMPATIBLE' ? 'DENY' : 'ALLOW',
          }),
        )
      mocks.rules.mockResolvedValue(rules)
      expect(
        await resolveFirmwareComplianceForDevice('device', at),
      ).toMatchObject({
        targetCompatibility: { status },
        recommendation:
          status === 'RESOLVED' ? 'PLATFORM_MIGRATION' : 'REVIEW_REQUIRED',
      })
    },
  )
  it('12,000 devices use five reads and preserve per-device policy identity', async () => {
    const devices = Array.from({ length: 12_000 }, (_, i) =>
      device(`device-${i}`),
    )
    mocks.devices.mockResolvedValue(devices)
    const start = performance.now()
    const values = await resolveFirmwareComplianceBatch(
      devices.map((d) => d.id),
      at,
    )
    const duration = performance.now() - start
    expect(values.size).toBe(12_000)
    for (const mock of Object.values(mocks))
      expect(mock).toHaveBeenCalledTimes(1)
    expect(values.get('device-11999')?.compliance).toBe('ACCEPTED')
    console.info(
      `12,000-device in-memory batch: ${Math.round(duration)}ms; five mocked reads`,
    )
  })
  it('empty batch performs no reads', async () => {
    expect((await resolveFirmwareComplianceBatch([])).size).toBe(0)
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled()
  })
})
