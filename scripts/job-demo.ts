import { JobSystem } from '../src/jobs/job-system.js'

const [command = 'enqueue', value] = process.argv.slice(2)
const system = await JobSystem.start({
  applicationName: 'noc-orchestrator-job-demo',
})

try {
  if (command === 'enqueue') {
    const marker = value?.trim() || `demo-${new Date().toISOString()}`
    const result = await system.enqueue(
      'example.some-job',
      { version: 1, marker },
      { correlationKey: `demo:${marker}` },
    )
    console.info(JSON.stringify({ command, marker, ...result }, null, 2))
  } else if (command === 'inspect') {
    if (!value) throw new Error('Usage: jobs:demo -- inspect <job-id>')
    const job = await system.inspect('example.some-job', value)
    console.info(JSON.stringify(job, null, 2))
  } else if (command === 'schedule') {
    const key = value?.trim() || 'demo-schedule'
    await system.scheduleRecurring(
      'example.some-job',
      '*/15 * * * *',
      { version: 1, marker: `scheduled:${key}` },
      { key, correlationKey: `demo-schedule:${key}` },
    )
    console.info(JSON.stringify({ command, key, cron: '*/15 * * * *' }, null, 2))
  } else if (command === 'unschedule') {
    const key = value?.trim() || 'demo-schedule'
    await system.unschedule('example.some-job', key)
    console.info(JSON.stringify({ command, key }, null, 2))
  } else {
    throw new Error(
      `Unknown command ${command}. Use enqueue, inspect, schedule, or unschedule.`,
    )
  }
} finally {
  await system.stop()
}
