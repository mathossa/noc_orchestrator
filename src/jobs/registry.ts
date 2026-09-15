import type { QueueOptions } from 'pg-boss'

export const JOB_NAMES = ['example.some-job'] as const

export type JobName = (typeof JOB_NAMES)[number]

export interface ExampleSomeJobPayload {
  version: 1
  marker: string
}

export interface ExampleSomeJobResult {
  version: 1
  marker: string
  handledAt: string
}

export interface JobPayloadMap {
  'example.some-job': ExampleSomeJobPayload
}

export interface JobResultMap {
  'example.some-job': ExampleSomeJobResult
}

export interface JobDefinition {
  queue: QueueOptions & {
    policy: 'exclusive'
  }
}

/**
 * Queue configuration is infrastructure policy only. A registered pg-boss job is
 * never authorization for a firmware/device change. Future execution work must
 * continue through the explicit approval and safety model owned by issue #82.
 */
export const JOB_DEFINITIONS: Record<JobName, JobDefinition> = {
  'example.some-job': {
    queue: {
      policy: 'exclusive',
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      expireInSeconds: 60,
      retentionSeconds: 14 * 24 * 60 * 60,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
}

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value)
}

export function parseJobPayload<N extends JobName>(
  name: N,
  value: unknown,
): JobPayloadMap[N] {
  switch (name) {
    case 'example.some-job': {
      if (
        !isRecord(value) ||
        value.version !== 1 ||
        !isNonEmptyString(value.marker)
      ) {
        throw new Error('Invalid payload for example.some-job')
      }

      return value as JobPayloadMap[N]
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
