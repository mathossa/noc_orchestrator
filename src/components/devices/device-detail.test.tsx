import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeviceOverview } from './device-detail'
import { deviceDetailFixture } from '@/lib/test-fixtures/device-detail'
import { result, release } from '@/lib/test-fixtures/firmware-compliance'
import { deviceFirmwareSummary } from '@/lib/device-overview'

function render(device = deviceDetailFixture()) {
  return renderToStaticMarkup(
    createElement(DeviceOverview, { device, onUpdate: () => {} }),
  )
}

describe('compact device overview', () => {
  it('shows a short healthy summary and identifiers without collapsed sections or empty exception/decision text', () => {
    const html = render()
    expect(html).toContain('Firmware is up to date.')
    for (const text of [
      'SERIAL-1',
      '10.0.0.1',
      'AP-505',
      'Add note',
      'Flag issue',
      'Edit device',
      'Details &amp; history',
    ])
      expect(html).toContain(text)
    for (const text of [
      'Record decision',
      'No decision',
      'No active exception',
      'explicitly permitted equivalent',
      '<details',
      'Firmware resolution',
      'Inventory context',
    ])
      expect(html).not.toContain(text)
    expect(html).toContain('/devices/customers/customer/sites/site/types/ap')
  })
  it('links to actual maintenance plans without offering per-device lifecycle actions', () => {
    const html = render(
      deviceDetailFixture({
        planning: {
          activePlans: [
            {
              id: 'plan',
              title: 'HQ Access Points',
              state: 'SCHEDULED',
              scheduledFor: '2026-10-01T18:00:00Z',
              proposedFor: null,
            },
          ],
          history: [],
        },
      }),
    )
    expect(html).toContain('href="/planning/plan"')
    expect(html).toContain('HQ Access Points')
    expect(html).not.toContain('Not included in a maintenance plan')
    expect(html).not.toContain('Record decision')
  })
  it('shows open issues and notes while keeping firmware current', () => {
    const html = render(
      deviceDetailFixture({
        issueReason: 'Cannot reach management',
        notes: 'Rack 2',
      }),
    )
    for (const text of [
      'Needs investigation',
      'Cannot reach management',
      'Resolve issue',
      'Rack 2',
      'Firmware is up to date.',
    ])
      expect(html).toContain(text)
  })
  it('keeps platform migrations explicit even when version labels coincide', () => {
    const firmware = result({
      recommendation: 'PLATFORM_MIGRATION',
      compliance: 'ACCEPTED',
    })
    const html = render(
      deviceDetailFixture({
        firmwareCompliance: firmware,
        desiredFirmware: {
          available: true,
          release: release('17.15.5', { platform: 'Different platform' }),
        },
      }),
    )
    expect(html).toContain('IOS XE')
    expect(html).toContain('Different platform')
    expect(html).toContain('A platform migration is recommended')
  })
  it('uses specific blocked/minimum/unknown guidance instead of a generic accepted explanation', () => {
    const blocked = deviceDetailFixture({
      firmwareCompliance: result({
        compliance: 'BLOCKED_RELEASE',
        recommendation: 'REVIEW_REQUIRED',
      }),
    })
    expect(deviceFirmwareSummary(blocked)).toContain(
      'Current release is blocked',
    )
    const required = deviceDetailFixture({
      firmwareCompliance: result({
        compliance: 'BELOW_MINIMUM',
        recommendation: 'UPDATE_REQUIRED',
      }),
    })
    expect(deviceFirmwareSummary(required)).toContain(
      'Below the minimum acceptable release',
    )
    const unknown = deviceDetailFixture({
      firmwareCompliance: result({
        compliance: 'NO_POLICY',
        recommendation: 'REVIEW_REQUIRED',
      }),
    })
    expect(deviceFirmwareSummary(unknown)).toContain('unknown')
  })
})
