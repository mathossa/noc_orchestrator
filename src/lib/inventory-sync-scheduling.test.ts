import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findSource: vi.fn(),
  start: vi.fn(),
  scheduleRecurring: vi.fn(),
  unschedule: vi.fn(),
  getSchedule: vi.fn(),
  previewRecurring: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { inventorySource: { findUnique: mocks.findSource } },
}))
vi.mock('@/jobs/job-system', () => ({
  JobSystem: { start: mocks.start },
}))
import {
  configureInventorySyncSchedule,
  getInventorySyncScheduleStatus,
} from '@/lib/inventory-sync-scheduling'

describe('inventory sync scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findSource.mockResolvedValue({
      id: 'source-1',
      provider: 'MERAKI',
      adapterType: 'meraki-dashboard-api-v1',
      enabled: true,
    })
    mocks.start.mockResolvedValue({
      scheduleRecurring: mocks.scheduleRecurring,
      unschedule: mocks.unschedule,
      getSchedule: mocks.getSchedule,
      previewRecurring: mocks.previewRecurring,
      stop: mocks.stop,
    })
    mocks.previewRecurring.mockReturnValue([new Date('2026-10-09T01:00:00.000Z')])
  })

  it('stores an editable recurring pg-boss schedule', async () => {
    mocks.getSchedule.mockResolvedValue({
      cron: '0 3 * * *',
      timezone: 'Europe/Amsterdam',
      lastJobId: null,
    })
    await expect(configureInventorySyncSchedule({
      sourceId: 'source-1',
      enabled: true,
      expression: '0 3 * * *',
      timezone: 'Europe/Amsterdam',
    })).resolves.toMatchObject({
      enabled: true,
      nextRunAt: '2026-10-09T01:00:00.000Z',
    })
    expect(mocks.scheduleRecurring).toHaveBeenCalledWith(
      'inventory.sync',
      '0 3 * * *',
      expect.objectContaining({ sourceId: 'source-1', provider: 'MERAKI' }),
      expect.objectContaining({
        key: 'inventory-source:source-1',
        timezone: 'Europe/Amsterdam',
      }),
    )
  })

  it('can disable and inspect the schedule without redeployment', async () => {
    await configureInventorySyncSchedule({ sourceId: 'source-1', enabled: false })
    expect(mocks.unschedule).toHaveBeenCalledWith(
      'inventory.sync',
      'inventory-source:source-1',
    )
    mocks.getSchedule.mockResolvedValue(null)
    await expect(getInventorySyncScheduleStatus('source-1')).resolves.toMatchObject({
      enabled: false,
      nextRunAt: null,
    })
  })
})
