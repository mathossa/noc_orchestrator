import { describe, expect, it } from 'vitest'
import { input, release } from './test-fixtures/firmware-compliance'
import { resolveFirmwareCompliance } from './firmware-compliance'
import {
  exceptionSubjectMatches,
  nextQuarter,
  parseExceptionInput,
  policyFingerprint,
  resolveFirmwareExceptions,
  type ExceptionRecord,
} from './firmware-exceptions'
const at = new Date('2026-09-09T12:00:00Z')
const device = {
  id: 'device',
  customerId: 'customer',
  siteId: 'site',
  deviceModelId: 'model',
  deviceModel: { familyId: 'family' },
}
const technical = () => resolveFirmwareCompliance(input('17.9.4'))
const raw = {
  scope: 'DEVICE',
  scopeId: 'device',
  subject: 'ALL_MAINTENANCE',
  reasonCode: 'CUSTOMER_DECLINED',
  duration: 'PERMANENT',
}
function row(patch: Partial<ExceptionRecord> = {}): ExceptionRecord {
  return {
    ...parseExceptionInput(raw, at),
    id: 'exception',
    scopeLabel: 'Device',
    actorUserId: 'actor',
    decidedAt: at,
    supersededAt: null,
    policySnapshots: {},
    ...patch,
  }
}
describe('scoped firmware exceptions', () => {
  it('keeps technical compliance unchanged while suppressing the operational recommendation', () => {
    const before = technical(),
      result = resolveFirmwareExceptions([row()], device, before, at)
    expect(result.technical).toBe(before)
    expect(result.technical.compliance).toBe('BELOW_MINIMUM')
    expect(result.technical.recommendation).toBe('UPDATE_REQUIRED')
    expect(result.operationalRecommendation).toBe('ACCEPTED_EXCEPTION')
  })
  it('resolves Device > Site > Customer > Model > Family and keeps all applicable history', () => {
    const rows = ['FAMILY', 'MODEL', 'CUSTOMER', 'SITE', 'DEVICE'].map(
      (scope) => row({ id: scope, scope, scopeId: scope.toLowerCase() }),
    )
    for (let i = 0; i < rows.length; i++) {
      const r = resolveFirmwareExceptions(
        rows.slice(0, i + 1),
        device,
        technical(),
        at,
      )
      expect(r.selected?.id).toBe(rows[i].id)
      expect(r.applicable).toHaveLength(i + 1)
    }
    expect(
      resolveFirmwareExceptions(
        [row({ scopeId: 'another-device' })],
        device,
        technical(),
        at,
      ).selected,
    ).toBeNull()
  })
  it('selects the newest decision at an equal scope with a stable tie break', () => {
    const older = row({ id: 'old', decidedAt: new Date(at.getTime() - 1000) }),
      newer = row({ id: 'new' })
    expect(
      resolveFirmwareExceptions([older, newer], device, technical(), at)
        .selected?.id,
    ).toBe('new')
  })
  it.each(['CUSTOM_DATE', 'UNTIL_EOL'])(
    'expires %s at the exact boundary and retains history',
    (duration) => {
      const r = resolveFirmwareExceptions(
        [row({ duration, expiresAt: at })],
        device,
        technical(),
        at,
      )
      expect(r.selected).toBeNull()
      expect(r.records[0].status).toBe('EXPIRED')
      expect(r.operationalRecommendation).toBe('UPDATE_REQUIRED')
    },
  )
  it('does not expire permanent exceptions or activate future decisions', () => {
    expect(
      resolveFirmwareExceptions(
        [row()],
        device,
        technical(),
        new Date('2040-01-01'),
      ).selected,
    ).not.toBeNull()
    expect(
      resolveFirmwareExceptions(
        [row({ decidedAt: new Date('2027-01-01') })],
        device,
        technical(),
        at,
      ).selected,
    ).toBeNull()
  })
  it('ends an exception without deleting its history', () => {
    const r = resolveFirmwareExceptions(
      [row({ supersededAt: at })],
      device,
      technical(),
      at,
    )
    expect(r.selected).toBeNull()
    expect(r.records[0].status).toBe('SUPERSEDED')
  })
  it('invalidates a per-device policy-change exception for a changed target, policy or new device', () => {
    const t = technical(),
      r = row({
        duration: 'POLICY_CHANGE',
        scope: 'CUSTOMER',
        scopeId: 'customer',
        policySnapshots: { device: policyFingerprint(t) },
      })
    expect(
      resolveFirmwareExceptions([r], device, t, at).selected,
    ).not.toBeNull()
    t.resolvedTarget = release('17.15.6')
    expect(
      resolveFirmwareExceptions([r], device, t, at).records[0].status,
    ).toBe('POLICY_CHANGED')
    expect(
      resolveFirmwareExceptions([r], { ...device, id: 'new' }, technical(), at)
        .selected,
    ).toBeNull()
  })
  it('matches exact builds and trains against the resolved recommendation target', () => {
    expect(
      exceptionSubjectMatches(
        row({ subject: 'RELEASE', releaseId: '17.15.5' }),
        technical(),
      ),
    ).toBe(true)
    expect(
      exceptionSubjectMatches(
        row({ subject: 'RELEASE', releaseId: '17.15.5a' }),
        technical(),
      ),
    ).toBe(false)
    expect(
      exceptionSubjectMatches(
        row({ subject: 'TRAIN', trainId: 'train' }),
        technical(),
      ),
    ).toBe(true)
    expect(
      exceptionSubjectMatches(
        row({ subject: 'TRAIN', trainId: 'other' }),
        technical(),
      ),
    ).toBe(false)
  })
  it('matches inclusive ranges only in the same comparable vendor/platform domain', () => {
    const r = row({
      subject: 'RANGE',
      vendorId: 'synthetic-vendor',
      platform: 'IOS XE',
      minimumVersion: '17.15.5',
      maximumVersion: '17.15.6',
    })
    expect(exceptionSubjectMatches(r, technical())).toBe(true)
    expect(
      exceptionSubjectMatches({ ...r, vendorId: 'other' }, technical()),
    ).toBe(false)
    expect(
      exceptionSubjectMatches({ ...r, minimumVersion: 'opaque' }, technical()),
    ).toBe(false)
    expect(
      exceptionSubjectMatches({ ...r, maximumVersion: '17.15.4' }, technical()),
    ).toBe(false)
  })
  it('distinguishes migration holds from ordinary update exceptions', () => {
    const t = {
      ...technical(),
      recommendation: 'PLATFORM_MIGRATION' as const,
      currentFirmware: release('8.10.0', { platform: 'AOS-8' }),
      resolvedTarget: release('10.7.0', { platform: 'AOS-10' }),
    }
    const r = row({
      subject: 'PLATFORM_MIGRATION',
      fromPlatform: 'AOS-8',
      toPlatform: 'AOS-10',
    })
    expect(exceptionSubjectMatches(r, t)).toBe(true)
    expect(exceptionSubjectMatches(r, technical())).toBe(false)
    expect(exceptionSubjectMatches({ ...r, toPlatform: 'AOS-CX' }, t)).toBe(
      false,
    )
  })
  it('supports temporary holds and keeps preferred firmware as no action', () => {
    expect(
      exceptionSubjectMatches(row({ subject: 'TEMPORARY_HOLD' }), technical()),
    ).toBe(true)
    const r = resolveFirmwareExceptions(
      [row()],
      device,
      resolveFirmwareCompliance(input()),
      at,
    )
    expect(r.operationalRecommendation).toBe('NO_ACTION')
    expect(r.selected).toBeNull()
  })
  it('defaults to a calendar quarter with month-end clamping', () => {
    expect(
      parseExceptionInput(
        { ...raw, duration: undefined },
        at,
      ).expiresAt?.toISOString(),
    ).toBe('2026-12-09T12:00:00.000Z')
    expect(nextQuarter(new Date('2026-01-31T12:00:00Z')).toISOString()).toBe(
      '2026-04-30T12:00:00.000Z',
    )
  })
  it('requires Other notes, known future EOL and valid ordered range bounds', () => {
    expect(() =>
      parseExceptionInput({ ...raw, reasonCode: 'OTHER' }, at),
    ).toThrow('notes')
    expect(() =>
      parseExceptionInput({ ...raw, duration: 'UNTIL_EOL' }, at),
    ).toThrow('future')
    expect(() =>
      parseExceptionInput(
        {
          ...raw,
          subject: 'RANGE',
          vendorId: 'vendor',
          platform: 'IOS XE',
          minimumVersion: '17.15.6',
          maximumVersion: '17.15.5',
        },
        at,
      ),
    ).toThrow('minimum')
    expect(() =>
      parseExceptionInput(
        {
          ...raw,
          subject: 'PLATFORM_MIGRATION',
          fromPlatform: 'AOS-8',
          toPlatform: 'AOS-8',
        },
        at,
      ),
    ).toThrow('different')
  })
})
