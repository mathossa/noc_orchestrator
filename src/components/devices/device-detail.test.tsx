import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeviceWorkspace, NetworkTab } from './device-detail'
import { deviceDetailFixture } from '@/lib/test-fixtures/device-detail'
import { result, release } from '@/lib/test-fixtures/firmware-compliance'
import { deviceFirmwareSummary } from '@/lib/device-overview'

function render(device = deviceDetailFixture()) {
  return renderToStaticMarkup(
    createElement(DeviceWorkspace, { device, onUpdate: () => {} }),
  )
}

describe('device detail workspace', () => {
  it('shows a compact overview with normal network-device inventory facts', () => {
    const html = render()

    for (const text of [
      'Device information',
      'Firmware',
      'Status &amp; compliance',
      'Maintenance',
      'SERIAL-1',
      '10.0.0.1',
      'AP-505',
      'Vendor',
      'Access Point',
      'Customer',
      'HQ',
      'Edit device',
      'Actions',
      'Overview',
      'Compliance',
      'Network',
      'Notes &amp; issues',
      'History',
      'View firmware details',
    ])
      expect(html).toContain(text)

    for (const text of [
      'Record decision',
      'Details &amp; history',
      'No active exception',
      '<details',
    ])
      expect(html).not.toContain(text)

    expect(html).toContain('/devices/customers/customer/sites/site/types/ap')
    expect(html).toContain('/devices/customers/customer/sites/site')
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

  it('keeps physical stack members inside the logical device network view', () => {
    const device = deviceDetailFixture({
      name: 'core-stack-01',
      topology: {
        id: 'topology-1',
        kind: 'STACK',
        provider: 'AUVIK',
        sourceAdapterId: 'xlsx',
        sourceGroupKey: 'group-1',
        lastSeenAt: '2026-09-23T12:00:00Z',
        members: [
          {
            id: 'member-1',
            position: 1,
            name: 'core-stack-01 Member 1',
            hostname: null,
            serialNumber: 'SER-MEMBER-1',
            macAddress: 'aa:bb:cc:dd:ee:01',
            deviceModelId: 'member-model',
            firmwareReleaseId: null,
            rawFirmwareVersion: '15.2(7)E9',
            rawSoftwareVersion: null,
            normalizedFirmwareVersion: '15.2(7)E9',
            provider: 'AUVIK',
            sourceAdapterId: 'xlsx',
            sourceId: 'auvik-member-1',
            isActive: true,
            lastSeenAt: '2026-09-23T12:00:00Z',
            deviceModel: {
              id: 'member-model',
              model: 'WS-C2960X-48FPS-L',
              vendor: { id: 'cisco', code: 'CISCO', name: 'Cisco' },
              deviceType: { id: 'switch', code: 'SWITCH', name: 'Switch' },
            },
            firmwareRelease: null,
          },
        ],
      },
    })
    const html = renderToStaticMarkup(
      createElement(NetworkTab, {
        device,
        sitePath: '/devices/customers/customer/sites/site',
      }),
    )

    expect(html).toContain('Stack members')
    expect(html).toContain('core-stack-01 Member 1')
    expect(html).toContain('WS-C2960X-48FPS-L')
    expect(html).toContain('SER-MEMBER-1')
    expect(html).toContain('15.2(7)E9')
    expect(html).toContain('not separate Inventory, compliance, planning, or reporting devices')
  })

  it('surfaces an open issue on the overview without expanding notes into the default view', () => {
    const html = render(
      deviceDetailFixture({
        issueReason: 'Cannot reach management',
        notes: 'Rack 2',
      }),
    )

    expect(html).toContain('Device issue')
    expect(html).toContain('Needs investigation')
    expect(html).not.toContain('Rack 2')
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
