import { describe, expect, it } from 'vitest'
import {
  normalizedInventorySource,
  type InventorySourceAdapter,
} from '@/lib/inventory-source-adapter'

describe('generic inventory source adapter boundary', () => {
  it('hands normalized staged rows to Importer v2 without coupling provider identity to transport', async () => {
    const adapter: InventorySourceAdapter<{ deviceName: string }> = {
      adapterType: 'fixture-api',
      loadAndNormalize({ source, input }) {
        return normalizedInventorySource({
          source,
          rows: [
            {
              rowNumber: 1,
              sourceRecordKey: 'device-1',
              rawValues: {
                deviceName: input.deviceName,
                sourceId: 'device-1',
              },
              sourceEvidence: { transport: 'fixture-api' },
            },
          ],
        })
      },
    }

    const result = await adapter.loadAndNormalize({
      source: {
        provider: 'AUVIK',
        adapterType: 'fixture-api',
        sourceAdapterId: 'auvik-api-v2:connection-1',
        name: 'Auvik API connection',
        enabled: true,
        configuration: {},
        metadata: null,
      },
      input: { deviceName: 'HQ-SW01' },
    })

    expect(result.source.provider).toBe('AUVIK')
    expect(result.source.adapterType).toBe('fixture-api')
    expect(result.source.sourceAdapterId).toBe('auvik-api-v2:connection-1')
    expect(result.rows).toEqual([
      expect.objectContaining({
        sourceRecordKey: 'device-1',
        rawValues: expect.objectContaining({
          deviceName: 'HQ-SW01',
          sourceId: 'device-1',
        }),
      }),
    ])
  })
})
