import { describe, expect, it } from 'vitest'
import {
  defaultFirmwareReviewWindow,
  firmwareReviewActionGroups,
  firmwareReviewDueState,
  firmwareReviewPlanningPresentation,
  firmwareReviewSnapshotHash,
  firmwareReviewWorkspaceMetrics,
  parseFirmwareReviewCycleInput,
  summarizeFirmwareReviewRows,
  type FirmwareReviewSnapshot,
  type FirmwareReviewSnapshotDevice,
} from '@/lib/firmware-review'

function device(
  overrides: Partial<FirmwareReviewSnapshotDevice> = {},
): FirmwareReviewSnapshotDevice {
  return {
    deviceId: 'device-1',
    deviceName: 'sw-1',
    hostname: 'sw-1.example.test',
    siteId: 'site-1',
    siteName: 'HQ',
    organizationUnit: { id: 'unit-1', name: 'Operations' },
    vendor: { id: 'vendor-1', code: 'VENDOR', name: 'Vendor' },
    deviceType: { id: 'switch', code: 'SWITCH', name: 'Switch' },
    model: {
      id: 'model-1',
      name: 'Switch 1',
      familyId: 'family-1',
      familyName: 'Switch family',
      platform: 'Network OS',
      preferredPlatform: 'Network OS',
    },
    inventorySource: { source: 'IMPORT', externalProvider: 'Test' },
    currentFirmware: {
      releaseId: 'release-current',
      platform: 'Network OS',
      version: '1.0',
      rawVersion: '1.0',
      observedAt: '2026-09-01T08:00:00.000Z',
      catalogState: 'VERIFIED',
      policyEligibility: 'ALLOWED',
    },
    technical: {
      compliance: 'ACCEPTED',
      relationToPreferred: 'BELOW_PREFERRED',
      recommendation: 'UPDATE_RECOMMENDED',
      label: 'Accepted — update recommended',
      explanation: 'Accepted track with a newer preferred target available.',
      effectiveTrack: null,
      policy: {
        id: 'policy-1',
        mode: 'MINIMUM',
        version: 1,
        trackKey: 'accepted-track',
        trackName: 'Accepted legacy track',
        trackClass: 'ACCEPTED',
        desiredPlatform: 'Network OS',
        minimumFirmwareReleaseId: 'release-current',
        targetFirmwareReleaseId: 'release-target',
        maximumFirmwareReleaseId: null,
        firmwareTrainId: 'train-1',
      },
      policySource: {
        scope: 'SITE',
        scopeId: 'site-1',
        subject: 'MODEL',
        subjectId: 'model-1',
        policyId: 'policy-1',
        trackKey: 'accepted-track',
        trackName: 'Accepted legacy track',
        trackClass: 'ACCEPTED',
        policyVersion: 1,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
      preferredTarget: {
        id: 'release-target',
        platform: 'Network OS',
        version: '2.0',
        logicalVersion: '2.0',
        trainId: 'train-1',
        trainName: 'Accepted legacy track',
      },
      resolvedTarget: {
        id: 'release-target',
        platform: 'Network OS',
        version: '2.0',
        logicalVersion: '2.0',
        variant: null,
        imageCode: null,
      },
    },
    exception: null,
    planning: null,
    attentionClass: 'FIRMWARE',
    ...overrides,
  }
}

function snapshot(devices: FirmwareReviewSnapshotDevice[]): FirmwareReviewSnapshot {
  return {
    schemaVersion: 2,
    reviewCycleId: 'cycle-1',
    reportVersion: 1,
    generatedAt: '2026-09-23T12:00:00.000Z',
    reviewPeriod: {
      start: '2026-06-23T00:00:00.000Z',
      end: '2026-09-23T00:00:00.000Z',
    },
    customer: { id: 'customer-1', name: 'Example' },
    summary: summarizeFirmwareReviewRows(
      devices.map((row) => ({
        deviceId: row.deviceId,
        deviceName: row.deviceName,
        siteId: row.siteId,
        siteName: row.siteName,
        compliance: row.technical.compliance,
        recommendation: row.technical.recommendation,
        exceptionReasonCode: row.exception?.reasonCode ?? null,
        planningState: row.planning?.state ?? null,
        attentionClass: row.attentionClass,
      })),
    ),
    sites: [
      {
        siteId: 'site-1',
        siteName: 'HQ',
        organizationUnit: { id: 'unit-1', name: 'Operations' },
        summary: summarizeFirmwareReviewRows(
          devices.map((row) => ({
            deviceId: row.deviceId,
            deviceName: row.deviceName,
            siteId: row.siteId,
            siteName: row.siteName,
            compliance: row.technical.compliance,
            recommendation: row.technical.recommendation,
            exceptionReasonCode: row.exception?.reasonCode ?? null,
            planningState: row.planning?.state ?? null,
            attentionClass: row.attentionClass,
          })),
        ),
        devices,
      },
    ],
  }
}

describe('firmware review domain', () => {
  it('defaults to an approximately quarterly review window and cadence', () => {
    const at = new Date('2026-09-22T16:00:00.000Z')
    expect(defaultFirmwareReviewWindow(at)).toEqual({
      periodStart: new Date('2026-06-22T16:00:00.000Z'),
      periodEnd: at,
      nextReviewAt: new Date('2026-12-22T16:00:00.000Z'),
    })

    expect(parseFirmwareReviewCycleInput({ customerId: 'customer-1' }, at)).toEqual({
      customerId: 'customer-1',
      periodStart: new Date('2026-06-22T16:00:00.000Z'),
      periodEnd: at,
      nextReviewAt: new Date('2026-12-22T16:00:00.000Z'),
      reviewerName: null,
    })
  })

  it('accepts custom review dates and rejects an inverted period', () => {
    expect(
      parseFirmwareReviewCycleInput(
        {
          customerId: 'customer-1',
          periodStart: '2026-04-01T00:00:00.000Z',
          periodEnd: '2026-09-01T00:00:00.000Z',
          nextReviewAt: '2027-01-15T00:00:00.000Z',
          reviewerName: 'Engineer',
        },
        new Date('2026-09-22T16:00:00.000Z'),
      ),
    ).toEqual({
      customerId: 'customer-1',
      periodStart: new Date('2026-04-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      nextReviewAt: new Date('2027-01-15T00:00:00.000Z'),
      reviewerName: 'Engineer',
    })

    expect(() =>
      parseFirmwareReviewCycleInput({
        customerId: 'customer-1',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-09-01T00:00:00.000Z',
      }),
    ).toThrow('Review period start must not be after its end.')
  })

  it('summarizes customer-facing technical, exception, and planning dimensions separately', () => {
    const summary = summarizeFirmwareReviewRows([
      {
        deviceId: 'd1',
        deviceName: 'sw-1',
        siteId: 's1',
        siteName: 'HQ',
        compliance: 'PREFERRED',
        recommendation: 'NO_ACTION',
        exceptionReasonCode: null,
        planningState: null,
        attentionClass: 'FIRMWARE',
      },
      {
        deviceId: 'd2',
        deviceName: 'sw-2',
        siteId: 's1',
        siteName: 'HQ',
        compliance: 'ACCEPTED',
        recommendation: 'UPDATE_RECOMMENDED',
        exceptionReasonCode: 'CUSTOMER_DECLINED',
        planningState: 'AWAITING_CUSTOMER',
        attentionClass: 'FIRMWARE',
      },
      {
        deviceId: 'd3',
        deviceName: 'ap-1',
        siteId: 's2',
        siteName: 'Branch',
        compliance: 'BELOW_MINIMUM',
        recommendation: 'UPDATE_REQUIRED',
        exceptionReasonCode: null,
        planningState: 'SCHEDULED',
        attentionClass: 'REPLACEMENT_OR_EOL',
      },
      {
        deviceId: 'd4',
        deviceName: 'fw-1',
        siteId: null,
        siteName: null,
        compliance: 'OUTSIDE_RANGE',
        recommendation: 'PLATFORM_MIGRATION',
        exceptionReasonCode: null,
        planningState: 'PROPOSED',
        attentionClass: 'UNMANAGED',
      },
    ])

    expect(summary).toEqual({
      totalDevices: 4,
      preferred: 1,
      accepted: 1,
      updateRecommended: 1,
      updateRequired: 1,
      platformMigration: 1,
      reviewRequired: 0,
      customerDeclined: 1,
      replacementOrEol: 1,
      unmanaged: 1,
      planned: 1,
      awaitingCustomer: 1,
      scheduled: 1,
    })
  })

  it('keeps due, upcoming, current and overdue review-cycle states distinct', () => {
    const at = new Date('2026-09-23T16:00:00.000Z')
    expect(firmwareReviewDueState(null, at)).toBe('NO_CYCLE')
    expect(
      firmwareReviewDueState({ nextReviewAt: '2026-09-22T23:59:00.000Z' }, at),
    ).toBe('OVERDUE')
    expect(
      firmwareReviewDueState({ nextReviewAt: '2026-09-23T00:01:00.000Z' }, at),
    ).toBe('DUE')
    expect(
      firmwareReviewDueState({ nextReviewAt: '2026-10-10T00:00:00.000Z' }, at),
    ).toBe('UPCOMING')
    expect(
      firmwareReviewDueState({ nextReviewAt: '2027-01-01T00:00:00.000Z' }, at),
    ).toBe('CURRENT')
  })

  it('keeps an accepted alternate track explained rather than turning it into an unexplained failure', () => {
    const accepted = device({
      technical: {
        ...device().technical,
        compliance: 'ACCEPTED',
        recommendation: 'NO_ACTION',
        label: 'Accepted — newer than preferred',
        explanation: 'This Site intentionally remains on an accepted alternate track.',
      },
    })
    const groups = firmwareReviewActionGroups(snapshot([accepted]))

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      actionKind: 'NO_ACTION',
      complianceStates: ['ACCEPTED'],
      tracks: [{ value: 'Accepted legacy track', count: 1 }],
    })
  })

  it('keeps update-required and update-recommended as different action groups', () => {
    const recommended = device({
      deviceId: 'recommended',
      technical: {
        ...device().technical,
        compliance: 'ACCEPTED',
        recommendation: 'UPDATE_RECOMMENDED',
      },
    })
    const required = device({
      deviceId: 'required',
      technical: {
        ...device().technical,
        compliance: 'BELOW_MINIMUM',
        recommendation: 'UPDATE_REQUIRED',
      },
    })

    expect(
      firmwareReviewActionGroups(snapshot([recommended, required])).map(
        (group) => group.actionKind,
      ),
    ).toEqual(['UPDATE_REQUIRED', 'UPDATE_RECOMMENDED'])
  })

  it('does not let an exception overwrite technical compliance or recommendation', () => {
    const excepted = device({
      exception: {
        id: 'exception-1',
        reasonCode: 'CUSTOMER_DECLINED',
        scope: 'SITE',
        scopeId: 'site-1',
        scopeLabel: 'HQ',
        subject: 'ALL_MAINTENANCE',
        duration: 'UNTIL_DATE',
        decidedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-10-15T00:00:00.000Z',
        contactReference: null,
        ticketReference: null,
        replacementRelated: false,
      },
    })
    const value = snapshot([excepted])

    expect(value.summary.accepted).toBe(1)
    expect(value.summary.updateRecommended).toBe(1)
    expect(value.summary.customerDeclined).toBe(1)
    expect(firmwareReviewActionGroups(value)[0]).toMatchObject({
      actionKind: 'UPDATE_RECOMMENDED',
      complianceStates: ['ACCEPTED'],
      exceptionReasonCodes: ['CUSTOMER_DECLINED'],
    })
  })

  it('distinguishes scheduled, proposed and unscheduled occurrences without inventing dates', () => {
    expect(firmwareReviewPlanningPresentation(null)).toEqual({
      kind: 'UNSCHEDULED',
      occurrence: null,
    })
    expect(
      firmwareReviewPlanningPresentation({
        id: 'plan-proposed',
        state: 'AWAITING_CUSTOMER',
        proposedFor: '2026-10-01T20:00:00.000Z',
        proposedMaintenanceWindowReference: 'Customer proposal',
        scheduledFor: null,
        maintenanceWindowReference: null,
        externalReference: null,
      }),
    ).toEqual({
      kind: 'PROPOSED',
      occurrence: '2026-10-01T20:00:00.000Z',
    })
    expect(
      firmwareReviewPlanningPresentation({
        id: 'plan-scheduled',
        state: 'SCHEDULED',
        proposedFor: '2026-10-01T20:00:00.000Z',
        proposedMaintenanceWindowReference: 'Customer proposal',
        scheduledFor: '2026-10-08T20:00:00.000Z',
        maintenanceWindowReference: 'Confirmed window',
        externalReference: 'CHG-123',
      }),
    ).toEqual({
      kind: 'SCHEDULED',
      occurrence: '2026-10-08T20:00:00.000Z',
    })
  })

  it('groups by Site and action dimensions so future partial decisions can target a group', () => {
    const first = device({ deviceId: 'd1' })
    const second = device({ deviceId: 'd2', deviceName: 'sw-2' })
    const migration = device({
      deviceId: 'd3',
      deviceName: 'sw-3',
      technical: {
        ...device().technical,
        compliance: 'OUTSIDE_RANGE',
        recommendation: 'PLATFORM_MIGRATION',
      },
    })

    const groups = firmwareReviewActionGroups(snapshot([first, second, migration]))
    expect(groups).toHaveLength(2)
    expect(groups.find((group) => group.actionKind === 'UPDATE_RECOMMENDED')).toMatchObject({
      siteId: 'site-1',
      deviceCount: 2,
      deviceIds: ['d1', 'd2'],
    })
    expect(groups.find((group) => group.actionKind === 'PLATFORM_MIGRATION')).toMatchObject({
      siteId: 'site-1',
      deviceCount: 1,
      deviceIds: ['d3'],
    })
  })

  it('keeps replacement/EOL separate from normal firmware recommendations', () => {
    const replacement = device({
      attentionClass: 'REPLACEMENT_OR_EOL',
      technical: {
        ...device().technical,
        recommendation: 'UPDATE_REQUIRED',
      },
    })
    const groups = firmwareReviewActionGroups(snapshot([replacement]))

    expect(groups[0].actionKind).toBe('REPLACEMENT_OR_EOL')
    expect(snapshot([replacement]).summary.replacementOrEol).toBe(1)
    expect(snapshot([replacement]).summary.updateRequired).toBe(1)
  })

  it('projects internal attention from stored snapshot dimensions', () => {
    const at = new Date('2026-09-23T12:00:00.000Z')
    const unplanned = device({
      deviceId: 'unplanned',
      technical: {
        ...device().technical,
        compliance: 'BLOCKED_RELEASE',
        recommendation: 'UPDATE_REQUIRED',
      },
    })
    const planned = device({
      deviceId: 'planned',
      exception: {
        id: 'exception-1',
        reasonCode: 'TEMPORARY_ACCEPTANCE',
        scope: 'SITE',
        scopeId: 'site-1',
        scopeLabel: 'HQ',
        subject: 'RELEASE',
        duration: 'UNTIL_DATE',
        decidedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-10-01T00:00:00.000Z',
        contactReference: null,
        ticketReference: null,
        replacementRelated: false,
      },
      planning: {
        id: 'plan-1',
        title: 'Quarterly firmware work',
        state: 'AWAITING_CUSTOMER',
        proposedFor: '2026-10-05T20:00:00.000Z',
        proposedMaintenanceWindowReference: 'Sunday window',
        scheduledFor: null,
        maintenanceWindowReference: null,
        externalReference: null,
      },
    })

    expect(firmwareReviewWorkspaceMetrics(snapshot([unplanned, planned]), at)).toMatchObject({
      updateRequired: 1,
      updateRecommended: 1,
      blockedReleases: 1,
      unplannedRecommendations: 1,
      awaitingCustomerPlans: 1,
      exceptionsExpiring: 1,
      missingExternalReferences: 1,
    })
  })

  it('hashes semantically identical snapshots identically regardless of object key order', () => {
    expect(
      firmwareReviewSnapshotHash({
        customer: { name: 'Example', id: 'c1' },
        counts: { preferred: 2, required: 1 },
      }),
    ).toBe(
      firmwareReviewSnapshotHash({
        counts: { required: 1, preferred: 2 },
        customer: { id: 'c1', name: 'Example' },
      }),
    )
  })
})
