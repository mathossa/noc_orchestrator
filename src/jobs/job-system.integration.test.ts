import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultJobHandlers, type JobHandlers } from './handlers'
import { JobSystem } from './job-system'

const databaseUrl = process.env.JOB_TEST_DATABASE_URL
const schema = `pgboss_test_${randomUUID().replaceAll('-', '')}`

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let latest = await read()

  while (!matches(latest) && Date.now() < deadline) {
    await sleep(100)
    latest = await read()
  }

  if (!matches(latest)) {
    throw new Error(`Timed out waiting for job state: ${JSON.stringify(latest)}`)
  }

  return latest
}

describe.skipIf(!databaseUrl).sequential(
  'pg-boss PostgreSQL background-job foundation',
  () => {
    const running = new Set<JobSystem>()

    async function start(
      overrides: Parameters<typeof JobSystem.start>[0] = {},
    ): Promise<JobSystem> {
      const system = await JobSystem.start({
        databaseUrl,
        schema,
        schedule: false,
        applicationName: 'noc-orchestrator-job-test',
        ...overrides,
      })
      running.add(system)
      return system
    }

    async function stop(system: JobSystem): Promise<void> {
      if (!running.delete(system)) return
      await system.stop()
    }

    afterEach(async () => {
      await Promise.allSettled([...running].map((system) => system.stop()))
      running.clear()
    })

    it('persists an enqueued job across producer restart and stores handler output', async () => {
      const producer = await start()
      const marker = `restart-${randomUUID()}`
      const submitted = await producer.enqueue('example.some-job', {
        version: 1,
        marker,
      })

      expect(submitted.accepted).toBe(true)
      expect(submitted.jobId).toBeTruthy()
      await stop(producer)

      const worker = await start()
      await worker.registerWorkers(undefined, { pollingIntervalSeconds: 0.5 })

      const completed = await waitFor(
        () => worker.inspect('example.some-job', submitted.jobId!),
        (job) => job?.state === 'completed',
      )

      expect(completed?.output).toMatchObject({
        version: 1,
        marker,
      })
    })

    it('rejects duplicate queued work sharing a correlation key', async () => {
      const system = await start()
      const correlationKey = `dedupe-${randomUUID()}`

      const first = await system.enqueue(
        'example.some-job',
        { version: 1, marker: 'first' },
        { correlationKey },
      )
      const duplicate = await system.enqueue(
        'example.some-job',
        { version: 1, marker: 'duplicate' },
        { correlationKey },
      )

      expect(first.accepted).toBe(true)
      expect(duplicate).toMatchObject({
        accepted: false,
        jobId: null,
        correlationKey,
      })
    })

    it('retries a failed handler and then completes', async () => {
      const system = await start()
      const marker = `retry-${randomUUID()}`
      const handlers = createDefaultJobHandlers()
      const original = handlers['example.some-job']

      handlers['example.some-job'] = async (context) => {
        if (context.payload.marker === marker && context.attempt === 1) {
          throw new Error('expected first-attempt failure')
        }
        return original(context)
      }

      await system.registerWorkers(handlers, { pollingIntervalSeconds: 0.5 })
      const submitted = await system.enqueue(
        'example.some-job',
        { version: 1, marker },
        { retryLimit: 1, retryDelay: 0, retryBackoff: false },
      )

      const completed = await waitFor(
        () => system.inspect('example.some-job', submitted.jobId!),
        (job) => job?.state === 'completed',
      )

      expect(completed?.retryCount).toBe(1)
    })

    it('leaves terminal failure observable after the retry limit', async () => {
      const system = await start()
      const marker = `terminal-${randomUUID()}`
      const handlers: JobHandlers = createDefaultJobHandlers()
      const original = handlers['example.some-job']

      handlers['example.some-job'] = async (context) => {
        if (context.payload.marker === marker) {
          throw new Error('expected terminal failure')
        }
        return original(context)
      }

      await system.registerWorkers(handlers, { pollingIntervalSeconds: 0.5 })
      const submitted = await system.enqueue(
        'example.some-job',
        { version: 1, marker },
        { retryLimit: 1, retryDelay: 0, retryBackoff: false },
      )

      const failed = await waitFor(
        () => system.inspect('example.some-job', submitted.jobId!),
        (job) => job?.state === 'failed',
      )

      expect(failed?.retryCount).toBe(1)
    })

    it('stores a recurring pg-boss schedule and executes its job', async () => {
      const system = await start({
        schedule: true,
        cronMonitorIntervalSeconds: 1,
        cronWorkerIntervalSeconds: 1,
      })
      const marker = `schedule-${randomUUID()}`
      const scheduleKey = `schedule-${randomUUID()}`

      await system.registerWorkers(undefined, { pollingIntervalSeconds: 0.5 })
      await system.scheduleRecurring(
        'example.some-job',
        '* * * * * *',
        { version: 1, marker },
        { key: scheduleKey, correlationKey: scheduleKey },
      )

      expect(await system.getSchedule('example.some-job', scheduleKey)).toMatchObject({
        name: 'example.some-job',
        key: scheduleKey,
      })

      const schedule = await waitFor(
        () => system.getSchedule('example.some-job', scheduleKey),
        (value) => value?.lastJobId != null,
      )
      const completed = await waitFor(
        () => system.inspect('example.some-job', schedule!.lastJobId!),
        (job) => job?.state === 'completed',
      )

      expect(completed?.data).toEqual({ version: 1, marker })
      await system.unschedule('example.some-job', scheduleKey)
    })

    it('waits for active work during graceful worker shutdown', async () => {
      const system = await start()
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let started!: () => void
      const didStart = new Promise<void>((resolve) => {
        started = resolve
      })

      const handlers = createDefaultJobHandlers()
      handlers['example.some-job'] = async (context) => {
        started()
        await released
        return {
          version: 1,
          marker: context.payload.marker,
          handledAt: new Date().toISOString(),
        }
      }

      await system.registerWorkers(handlers, { pollingIntervalSeconds: 0.5 })
      await system.enqueue('example.some-job', {
        version: 1,
        marker: `shutdown-${randomUUID()}`,
      })
      await didStart

      let stopped = false
      const stopping = system.stop().then(() => {
        stopped = true
      })
      running.delete(system)

      await sleep(100)
      expect(stopped).toBe(false)

      release()
      await stopping
      expect(stopped).toBe(true)
    })
  },
)
