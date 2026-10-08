import type { JobName, JobPayloadMap, JobResultMap } from './registry.js'

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
      if (
        payload.provider !== 'MERAKI' ||
        payload.adapterType !== 'meraki-dashboard-api-v1'
      ) {
        throw new Error(
          `No scheduled inventory sync handler exists for ${payload.provider}/${payload.adapterType}.`,
        )
      }
      const { runMerakiInventorySync } = await import('../lib/meraki-inventory-sync.js')
      const result = await runMerakiInventorySync(payload.sourceId, {
        trigger: 'SCHEDULED',
      })
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
