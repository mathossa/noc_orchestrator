import { beforeEach, describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'
import { policy, release } from './test-fixtures/firmware-compliance'
const mocks = vi.hoisted(() => ({
  devices: vi.fn(),
  policies: vi.fn(),
  releases: vi.fn(),
  rules: vi.fn(),
  overrides: vi.fn(),
  trains: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: { findMany: mocks.devices },
    firmwarePolicy: { findMany: mocks.policies },
    firmwareRelease: { findMany: mocks.releases },
    firmwareCompatibilityRule: { findMany: mocks.rules },
    firmwareCompatibilityOverride: { findMany: mocks.overrides },
    firmwareTrain: { findMany: mocks.trains },
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
      platform: 'IOS XE',
      preferredPlatform: null,
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
  mocks.trains.mockResolvedValue([])
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
  it('uses catalog train defaults when no scoped policy exists', async () => {
    mocks.policies.mockResolvedValue([])
    mocks.trains.mockResolvedValue([
      {
        id: 'train',
        vendorId: 'synthetic-vendor',
        platform: 'IOS XE',
        name: '17.15',
        state: 'PREFERRED',
        preferredFirmwareReleaseId: '17.15.5',
        minimumAcceptableFirmwareReleaseId: '17.12.5',
      },
    ])
    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'ACCEPTED',
      recommendation: 'UPDATE_RECOMMENDED',
      policySource: { scope: 'CATALOG', trackName: '17.15' },
      preferredTarget: { id: '17.15.5' },
      minimum: { id: '17.12.5' },
    })
  })

  it('reports a missing preferred train as catalog configuration, not compatibility', async () => {
    mocks.policies.mockResolvedValue([])
    mocks.trains.mockResolvedValue([])

    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'NO_POLICY',
      effectivePolicy: {
        status: 'UNRESOLVED',
        unresolvedReason: 'CATALOG_PREFERRED_TRAIN_UNRESOLVED',
      },
    })
  })

  it('requires an explicit preferred platform when a model supports multiple platforms', async () => {
    mocks.policies.mockResolvedValue([])
    mocks.devices.mockResolvedValue([
      {
        ...device(),
        currentFirmwareReleaseId: '8.10.21',
        deviceModel: {
          ...device().deviceModel,
          platform: 'AOS-8, AOS-10',
          preferredPlatform: null,
        },
      },
    ])
    mocks.releases.mockResolvedValue([
      release('8.10.21', { platform: 'AOS-8', firmwareTrainId: 'aos8-train' }),
      release('10.1', { platform: 'AOS-10', firmwareTrainId: 'aos10-train' }),
    ])
    mocks.rules.mockResolvedValue([
      rule({ id: 'aos8', platform: 'AOS-8' }),
      rule({ id: 'aos10', platform: 'AOS-10' }),
    ])

    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'NO_POLICY',
      effectivePolicy: {
        status: 'UNRESOLVED',
        unresolvedReason: 'CATALOG_PLATFORM_UNRESOLVED',
      },
    })
  })

  it('recommends a platform migration from a supported alternate platform to the model preferred platform', async () => {
    mocks.policies.mockResolvedValue([])
    mocks.devices.mockResolvedValue([
      {
        ...device(),
        currentFirmwareReleaseId: '8.10.21',
        deviceModel: {
          ...device().deviceModel,
          platform: 'AOS-8, AOS-10',
          preferredPlatform: 'AOS-10',
        },
      },
    ])
    mocks.releases.mockResolvedValue([
      release('8.10.21', { platform: 'AOS-8', firmwareTrainId: 'aos8-train' }),
      release('10.1', { platform: 'AOS-10', firmwareTrainId: 'aos10-train' }),
    ])
    mocks.trains.mockResolvedValue([
      {
        id: 'aos10-train',
        vendorId: 'synthetic-vendor',
        platform: 'AOS-10',
        name: '10.1',
        state: 'PREFERRED',
        preferredFirmwareReleaseId: '10.1',
        minimumAcceptableFirmwareReleaseId: null,
      },
    ])
    mocks.rules.mockResolvedValue([
      rule({ id: 'aos8', platform: 'AOS-8' }),
      rule({ id: 'aos10', platform: 'AOS-10' }),
    ])

    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'OUTSIDE_RANGE',
      recommendation: 'PLATFORM_MIGRATION',
      policySource: { scope: 'CATALOG', trackName: '10.1' },
      currentFirmware: { platform: 'AOS-8' },
      preferredTarget: { platform: 'AOS-10', version: '10.1' },
    })
  })

  it('lets a site policy keep a supported alternate platform compliant', async () => {
    mocks.devices.mockResolvedValue([
      {
        ...device(),
        currentFirmwareReleaseId: '8.10.21',
        deviceModel: {
          ...device().deviceModel,
          platform: 'AOS-8, AOS-10',
          preferredPlatform: 'AOS-10',
        },
      },
    ])
    mocks.policies.mockResolvedValue([
      policy({
        id: 'site-aos8',
        siteId: 'site',
        policyMode: 'LATEST_APPROVED_IN_TRAIN',
        desiredPlatform: 'AOS-8',
        firmwareTrainId: 'aos8-train',
        targetFirmwareReleaseId: null,
        minimumFirmwareReleaseId: null,
      }),
    ])
    mocks.releases.mockResolvedValue([
      release('8.10.21', { platform: 'AOS-8', firmwareTrainId: 'aos8-train' }),
      release('10.1', { platform: 'AOS-10', firmwareTrainId: 'aos10-train' }),
    ])
    mocks.rules.mockResolvedValue([
      rule({ id: 'aos8', platform: 'AOS-8' }),
      rule({ id: 'aos10', platform: 'AOS-10' }),
    ])

    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'PREFERRED',
      recommendation: 'NO_ACTION',
      policySource: { scope: 'SITE', policyId: 'site-aos8' },
      preferredTarget: { platform: 'AOS-8', version: '8.10.21' },
    })
  })

  it('falls back from an incompatible preferred train to a known-compatible Accepted train', async () => {
    mocks.policies.mockResolvedValue([])
    mocks.devices.mockResolvedValue([{ ...device(), currentFirmwareReleaseId: '17.12.5' }])
    mocks.releases.mockResolvedValue([
      release('17.12.5', { firmwareTrainId: 'train-accepted' }),
      release('17.15.5', { firmwareTrainId: 'train-preferred' }),
    ])
    mocks.trains.mockResolvedValue([
      {
        id: 'train-preferred',
        vendorId: 'synthetic-vendor',
        platform: 'IOS XE',
        name: '17.15',
        state: 'PREFERRED',
        preferredFirmwareReleaseId: '17.15.5',
        minimumAcceptableFirmwareReleaseId: null,
      },
      {
        id: 'train-accepted',
        vendorId: 'synthetic-vendor',
        platform: 'IOS XE',
        name: '17.12',
        state: 'ACCEPTED',
        preferredFirmwareReleaseId: '17.12.5',
        minimumAcceptableFirmwareReleaseId: null,
      },
    ])
    mocks.rules.mockResolvedValue([
      rule({ id: 'platform-allow' }),
      rule({
        id: 'preferred-train-deny',
        firmwareTrainId: 'train-preferred',
        decision: 'DENY',
        explanation: 'This model cannot use the platform preferred train.',
      }),
    ])

    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'PREFERRED',
      policySource: { scope: 'CATALOG', trackName: '17.12', trackClass: 'ACCEPTED' },
      preferredTarget: { id: '17.12.5' },
    })
  })

    it('uses exact semantics for catalog trains without a minimum', async () => {
    mocks.policies.mockResolvedValue([])
    mocks.devices.mockResolvedValue([{ ...device(), currentFirmwareReleaseId: '17.15.6' }])
    mocks.releases.mockResolvedValue([release('17.15.5'), release('17.15.6')])
    mocks.trains.mockResolvedValue([
      {
        id: 'train',
        vendorId: 'synthetic-vendor',
        platform: 'IOS XE',
        name: '17.15',
        state: 'PREFERRED',
        preferredFirmwareReleaseId: '17.15.5',
        minimumAcceptableFirmwareReleaseId: null,
      },
    ])
    expect(await resolveFirmwareComplianceForDevice('device', at)).toMatchObject({
      compliance: 'OUTSIDE_RANGE',
      policySource: { scope: 'CATALOG' },
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
  it('12,000 devices use six bounded reads and preserve per-device policy identity', async () => {
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
      `12,000-device in-memory batch: ${Math.round(duration)}ms; six mocked reads`,
    )
  })
  it('empty batch performs no reads', async () => {
    expect((await resolveFirmwareComplianceBatch([])).size).toBe(0)
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled()
  })
})
