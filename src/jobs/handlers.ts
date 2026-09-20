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

export type JobHandlers = {
  [N in JobName]: JobHandler<N>
}

/**
 * Default handlers intentionally contain no firmware execution behavior.
 * Queue delivery is transport, not permission to change a device.
 */
export function createDefaultJobHandlers(): JobHandlers {
  return {
    'example.some-job': async ({ payload }) => ({
      version: 1,
      marker: payload.marker,
      handledAt: new Date().toISOString(),
    }),
  }
}
