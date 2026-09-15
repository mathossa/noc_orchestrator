import { JobSystem } from '../src/jobs/job-system.js'

const system = await JobSystem.start({
  applicationName: 'noc-orchestrator-worker',
})

await system.registerWorkers()

console.info(
  JSON.stringify({
    component: 'background-worker',
    event: 'ready',
  }),
)

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  console.info(
    JSON.stringify({
      component: 'background-worker',
      event: 'shutdown-started',
      signal,
    }),
  )

  try {
    await system.stop()
    console.info(
      JSON.stringify({
        component: 'background-worker',
        event: 'shutdown-completed',
        signal,
      }),
    )
  } catch (error) {
    process.exitCode = 1
    console.error(
      JSON.stringify({
        component: 'background-worker',
        event: 'shutdown-failed',
        signal,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
