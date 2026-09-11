import { beforeEach, describe, expect, it, vi } from 'vitest'
import { result as complianceResult } from './test-fixtures/firmware-compliance'

const mocks = vi.hoisted(() => ({
  exceptions: vi.fn(),
  reasons: vi.fn(),
  models: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    firmwareException: { findMany: mocks.exceptions },
    firmwareExceptionReason: { findMany: mocks.reasons },
    deviceModel: { findMany: mocks.models },
  },
}))

import {
  listDeviceExceptionReasonReferences,
  resolveDeviceExceptionSummaries,
} from './device-exception-summary-store'

const at = new Date('2026-09-11T12:00:00Z')

function exceptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exception-model',
    scope: 'MODEL',
    scopeId: 'model-1',
    scopeLabel: 'C9300-24P',
    subject: 'ALL_MAINTENANCE',
    reasonCode: 'NO_OPERATIONAL_BENEFIT',
    notes: null,
    releaseId: null,
    vendorId: null,
    platform: null,
    minimumVersion: null,
    maximumVersion: null,
    trainId: null,
    fromPlatform: null,
    toPlatform: null,
    duration: 'NEXT_REVIEW',
    expiresAt: new Date('2026-12-11T12:00:00Z'),
    policySnapshots: {},
    actorUserId: null,
    contactReference: null,
    ticketReference: null,
    decidedAt: at,
    supersededAt: null,
    supersededByUserId: null,
    legacyLifecycleId: null,
    legacyEvidence: null,
    ...overrides,
  }
}

const device = {
  id: 'device-1',
  customerId: 'customer-1',
  siteId: 'site-1',
  deviceModelId: 'model-1',
}

describe('device exception overview summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reasons.mockResolvedValue([
      { code: 'CUSTOMER_DECLINED', label: 'Customer declined' },
      { code: 'NO_OPERATIONAL_BENEFIT', label: 'No operational benefit' },
    ])
    mocks.models.mockResolvedValue([{ id: 'model-1', familyId: 'family-1' }])
  })

  it('projects the winning Customer exception while retaining the broader Model decision count', async () => {
    mocks.exceptions.mockResolvedValue([
      exceptionRow(),
      exceptionRow({
        id: 'exception-customer',
        scope: 'CUSTOMER',
        scopeId: 'customer-1',
        scopeLabel: 'Acme',
        reasonCode: 'CUSTOMER_DECLINED',
        decidedAt: new Date('2026-09-11T11:59:00Z'),
      }),
    ])

    const technical = complianceResult({ recommendation: 'UPDATE_REQUIRED' })
    const result = await resolveDeviceExceptionSummaries(
      [device],
      new Map([[device.id, technical]]),
      at,
    )

    expect(result.get(device.id)).toMatchObject({
      state: 'ACTIVE',
      activeCount: 2,
      inheritedCount: 1,
      effective: {
        id: 'exception-customer',
        reasonCode: 'CUSTOMER_DECLINED',
        reasonLabel: 'Customer declined',
        scope: 'CUSTOMER',
        scopeLabel: 'Acme',
      },
    })
  })

  it('keeps active exception records visible when technical compliance needs no action', async () => {
    mocks.exceptions.mockResolvedValue([exceptionRow()])
    const technical = complianceResult({ recommendation: 'NO_ACTION' })
    const result = await resolveDeviceExceptionSummaries(
      [device],
      new Map([[device.id, technical]]),
      at,
    )

    expect(result.get(device.id)).toMatchObject({
      state: 'ACTIVE',
      effective: null,
      activeCount: 1,
      inheritedCount: 1,
    })
  })

  it('lists active reason codes for device filters', async () => {
    mocks.reasons.mockResolvedValue([
      { code: 'CUSTOMER_DECLINED', label: 'Customer declined' },
    ])
    expect(await listDeviceExceptionReasonReferences()).toEqual([
      { code: 'CUSTOMER_DECLINED', label: 'Customer declined' },
    ])
  })
})