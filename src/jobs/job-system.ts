import { randomUUID } from 'node:crypto'
import { PgBoss } from 'pg-boss'
import type {
  JobWithMetadata,
  Schedule,
  ScheduleOptions,
  SendOptions,
} from 'pg-boss'
import {
  createDefaultJobHandlers,
  type JobHandler,
  type JobHandlers,
} from './handlers.js'
import {
  JOB_DEFINITIONS,
  JOB_NAMES,
  parseJobPayload,
  type JobName,
  type JobPayloadMap,
  type JobResultMap,
} from './registry.js'

export interface JobSystemOptions {
  databaseUrl?: string
  schema?: string
  applicationName?: string
  schedule?: boolean
  maxConnections?: number
  cronMonitorIntervalSeconds?: number
  cronWorkerIntervalSeconds?: number
}

export interface EnqueueOptions {
  correlationKey?: string
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  expireInSeconds?: number
  startAfter?: SendOptions['startAfter']
}

export interface EnqueueResult {
  jobId: string | null
  correlationKey: string
  accepted: boolean
}

export interface RecurringScheduleOptions {
  key?: string
  timezone?: string
  missed?: 'skip' | 'once'
  correlationKey?: string
}

export interface WorkerOptions {
  pollingIntervalSeconds?: number
}

export interface JobLogEvent {
  component: 'background-job'
  event:
    | 'started'
    | 'succeeded'
    | 'failed'
    | 'queue-error'
    | 'queue-warning'
  jobName?: JobName
  jobId?: string
  correlationKey?: string | null
  attempt?: number
  durationMs?: number
  error?: string
}

type JobLogger = (event: JobLogEvent) => void

export class JobSystem {
  private constructor(
    private readonly boss: PgBoss,
    private readonly logger: JobLogger,
  ) {}

  static async start(
    options: JobSystemOptions = {},
    logger: JobLogger = defaultJobLogger,
  ): Promise<JobSystem> {
    const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set')
    }

    const boss = new PgBoss({
      connectionString: databaseUrl,
      schema: options.schema ?? 'pgboss',
      application_name:
        options.applicationName ?? 'noc-orchestrator-background-jobs',
      schedule: options.schedule ?? true,
      max: options.maxConnections ?? 5,
      ...(options.cronMonitorIntervalSeconds === undefined
        ? {}
        : { cronMonitorIntervalSeconds: options.cronMonitorIntervalSeconds }),
      ...(options.cronWorkerIntervalSeconds === undefined
        ? {}
        : { cronWorkerIntervalSeconds: options.cronWorkerIntervalSeconds }),
    })

    boss.on('error', (error) => {
      logger({
        component: 'background-job',
        event: 'queue-error',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    boss.on('warning', (warning) => {
      logger({
        component: 'background-job',
        event: 'queue-warning',
        error: warning instanceof Error ? warning.message : String(warning),
      })
    })

    await boss.start()
    const system = new JobSystem(boss, logger)

    try {
      await system.ensureQueues()
      return system
    } catch (error) {
      await boss.stop({ graceful: false }).catch(() => undefined)
      throw error
    }
  }

  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloadMap[N],
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    parseJobPayload(name, payload)
    const correlationKey = options.correlationKey ?? randomUUID()

    const jobId = await this.boss.send(name, payload, {
      singletonKey: correlationKey,
      retryLimit: options.retryLimit,
      retryDelay: options.retryDelay,
      retryBackoff: options.retryBackoff,
      expireInSeconds: options.expireInSeconds,
      startAfter: options.startAfter,
    })

    return {
      jobId,
      correlationKey,
      accepted: jobId !== null,
    }
  }

  async registerWorkers(
    handlers: JobHandlers = createDefaultJobHandlers(),
    options: WorkerOptions = {},
  ): Promise<void> {
    for (const name of JOB_NAMES) {
      await this.registerWorker(name, handlers[name], options)
    }
  }

  async inspect<N extends JobName>(
    name: N,
    jobId: string,
  ): Promise<JobWithMetadata<JobPayloadMap[N]> | null> {
    const [job] = await this.boss.findJobs<JobPayloadMap[N]>(name, {
      id: jobId,
    })
    return job ?? null
  }

  async cancel<N extends JobName>(name: N, jobId: string): Promise<void> {
    // pg-boss can move queued/active jobs to cancelled state, but cancellation
    // cannot undo arbitrary side effects an active handler already performed.
    await this.boss.cancel(name, jobId)
  }

  async scheduleRecurring<N extends JobName>(
    name: N,
    expression: string,
    payload: JobPayloadMap[N],
    options: RecurringScheduleOptions = {},
  ): Promise<void> {
    parseJobPayload(name, payload)
    const scheduleKey = options.key ?? ''
    const correlationKey =
      options.correlationKey ?? `schedule:${name}:${scheduleKey || 'default'}`

    const scheduleOptions: ScheduleOptions = {
      key: options.key,
      tz: options.timezone,
      missed: options.missed,
      singletonKey: correlationKey,
    }

    await this.boss.schedule(name, expression, payload, scheduleOptions)
  }

  async getSchedule<N extends JobName>(
    name: N,
    key?: string,
  ): Promise<Schedule | null> {
    return this.boss.getSchedule(name, key)
  }

  async unschedule<N extends JobName>(name: N, key?: string): Promise<void> {
    await this.boss.unschedule(name, key)
  }

  async stop(timeout = 30_000): Promise<void> {
    // pg-boss stops worker polling first, then waits for active handlers before
    // closing its own pool. This is the graceful intake/shutdown boundary.
    await this.boss.stop({ graceful: true, timeout })
  }

  private async ensureQueues(): Promise<void> {
    for (const name of JOB_NAMES) {
      const definition = JOB_DEFINITIONS[name]
      const current = await this.boss.getQueue(name)

      if (!current) {
        await this.boss.createQueue(name, definition.queue)
        continue
      }

      if (current.policy !== definition.queue.policy) {
        throw new Error(
          `Queue ${name} uses policy ${current.policy}; expected ${definition.queue.policy}`,
        )
      }

      const { policy: _policy, ...mutableOptions } = definition.queue
      await this.boss.updateQueue(name, mutableOptions)
    }
  }

  private async registerWorker<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
    options: WorkerOptions,
  ): Promise<void> {
    await this.boss.work<JobPayloadMap[N], JobResultMap[N]>(
      name,
      {
        batchSize: 1,
        includeMetadata: true,
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
      },
      async (jobs) => {
        const [job] = jobs
        if (!job) {
          throw new Error(`pg-boss delivered an empty batch for ${name}`)
        }
        return this.execute(name, job, handler)
      },
    )
  }

  private async execute<N extends JobName>(
    name: N,
    job: JobWithMetadata<JobPayloadMap[N]>,
    handler: JobHandler<N>,
  ): Promise<JobResultMap[N]> {
    const started = Date.now()
    const payload = parseJobPayload(name, job.data)
    const attempt = job.retryCount + 1

    this.logger({
      component: 'background-job',
      event: 'started',
      jobName: name,
      jobId: job.id,
      correlationKey: job.singletonKey,
      attempt,
    })

    try {
      const result = await handler({
        jobId: job.id,
        jobName: name,
        payload,
        attempt,
        correlationKey: job.singletonKey,
      })
      this.logger({
        component: 'background-job',
        event: 'succeeded',
        jobName: name,
        jobId: job.id,
        correlationKey: job.singletonKey,
        attempt,
        durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      this.logger({
        component: 'background-job',
        event: 'failed',
        jobName: name,
        jobId: job.id,
        correlationKey: job.singletonKey,
        attempt,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

export function defaultJobLogger(event: JobLogEvent): void {
  const method =
    event.event === 'failed' || event.event === 'queue-error' ? 'error' : 'info'
  console[method](JSON.stringify(event))
}
