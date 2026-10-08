import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  meraki: vi.fn(),
  auvik: vi.fn(),
}))

vi.mock('@/lib/meraki-inventory-sync', () => ({
  runMerakiInventorySync: mocks.meraki,
}))
vi.mock('@/lib/auvik-inventory-sync', () => ({
  runAuvikInventorySync: mocks.auvik,
}))

import { createDefaultJobHandlers } from './handlers'

function scheduledPayload(provider: string, adapterType: string) {
  return {
    jobId: 'scheduled-job',
    jobName: 'inventory.sync' as const,
    payload: { version: 1 as const, sourceId: 'source-1', provider, adapterType },
    attempt: 1,
    correlationKey: null,
  }
}

describe('shared inventory sync job dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.meraki.mockResolvedValue({
      syncRun: { id: 'meraki-run', status: 'SUCCEEDED' },
      source: { partial: false },
    })
    mocks.auvik.mockResolvedValue({
      syncRun: { id: 'auvik-run', status: 'PARTIAL' },
      source: { partial: true },
    })
  })

  it('uses the existing Meraki sync service with SCHEDULED trigger', async () => {
    const result = await createDefaultJobHandlers()['inventory.sync'](
      scheduledPayload('MERAKI', 'meraki-dashboard-api-v1'),
    )
    expect(mocks.meraki).toHaveBeenCalledWith('source-1', { trigger: 'SCHEDULED' })
    expect(mocks.auvik).not.toHaveBeenCalled()
    expect(result).toMatchObject({ runId: 'meraki-run', status: 'SUCCEEDED' })
  })

  it('uses the existing Auvik sync service with SCHEDULED trigger', async () => {
    const result = await createDefaultJobHandlers()['inventory.sync'](
      scheduledPayload('AUVIK', 'auvik-api-v2'),
    )
    expect(mocks.auvik).toHaveBeenCalledWith('source-1', { trigger: 'SCHEDULED' })
    expect(mocks.meraki).not.toHaveBeenCalled()
    expect(result).toMatchObject({ runId: 'auvik-run', status: 'PARTIAL' })
  })

  it('does not execute a mismatched or unknown adapter', async () => {
    await expect(
      createDefaultJobHandlers()['inventory.sync'](
        scheduledPayload('AUVIK', 'meraki-dashboard-api-v1'),
      ),
    ).rejects.toThrow('No scheduled inventory sync handler')
    expect(mocks.auvik).not.toHaveBeenCalled()
    expect(mocks.meraki).not.toHaveBeenCalled()
  })
})
