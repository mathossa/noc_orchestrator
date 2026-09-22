import { describe, expect, it } from 'vitest'
import {
  defaultFirmwareReviewWindow,
  firmwareReviewSnapshotHash,
  parseFirmwareReviewCycleInput,
  summarizeFirmwareReviewRows,
} from '@/lib/firmware-review'

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
