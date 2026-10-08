import type { JobName, JobPayloadMap, JobResultMap } from '@/jobs/registry'

export interface JobHandlerContext<N extends JobName> {
  jobId: string
  jobName: N
  payload: JobPayloadMap[N]
  attempt: number
  correlationKey: string | null
}
export type JobHandler<N extends JobName> = (
  context: JobHandlerContext<N>,
) => Promise<JobResultMap[N]>
export type JobHandlers = { [N in JobName]: JobHandler<N> }

export function createDefaultJobHandlers(): JobHandlers {
  return {
    'example.some-job': async ({ payload }) => ({
      version: 1,
      marker: payload.marker,
      handledAt: new Date().toISOString(),
    }),
    'inventory.sync': async ({ payload }) => {
      // Dispatch to existing provider services, not a second importer or queue.
      let result: {
        syncRun: { id: string; status: string }
        source: { partial: boolean }
      }
      if (payload.provider === 'MERAKI' && payload.adapterType === 'meraki-dashboard-api-v1') {
        const { runMerakiInventorySync } = await import('@/lib/meraki-inventory-sync')
        result = await runMerakiInventorySync(payload.sourceId, { trigger: 'SCHEDULED' })
      } else if (payload.provider === 'AUVIK' && payload.adapterType === 'auvik-api-v2') {
        const { runAuvikInventorySync } = await import('@/lib/auvik-inventory-sync')
        result = await runAuvikInventorySync(payload.sourceId, { trigger: 'SCHEDULED' })
      } else {
        throw new Error(
          `No scheduled inventory sync handler exists for ${payload.provider}/${payload.adapterType}.`,
        )
      }
      return {
        version: 1,
        sourceId: payload.sourceId,
        provider: payload.provider,
        runId: result.syncRun.id,
        status: result.source.partial ? 'PARTIAL' : 'SUCCEEDED',
      }
    },
  }
}
