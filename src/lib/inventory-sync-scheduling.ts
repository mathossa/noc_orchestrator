import { prisma } from '@/lib/prisma'
import { JobSystem } from '@/jobs/job-system'

const INVENTORY_SYNC_JOB = 'inventory.sync' as const

function scheduleKey(sourceId: string) {
  return `inventory-source:${sourceId}`
}

async function withJobSystem<T>(callback: (system: JobSystem) => Promise<T>) {
  const system = await JobSystem.start({
    applicationName: 'noc-orchestrator-inventory-schedule-admin',
    schedule: false,
  })
  try {
    return await callback(system)
  } finally {
    await system.stop()
  }
}

export async function getInventorySyncScheduleStatus(sourceId: string) {
  const source = await prisma.inventorySource.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      provider: true,
      adapterType: true,
    },
  })
  if (!source) throw new Error('Inventory source was not found.')

  return withJobSystem(async (system) => {
    const schedule = await system.getSchedule(
      INVENTORY_SYNC_JOB,
      scheduleKey(sourceId),
    )
    if (!schedule) {
      return {
        enabled: false,
        expression: null,
        timezone: null,
        nextRunAt: null,
        lastJobId: null,
      }
    }
    const preview = system.previewRecurring(schedule.cron, schedule.timezone)
    return {
      enabled: true,
      expression: schedule.cron,
      timezone: schedule.timezone,
      nextRunAt: preview[0]?.toISOString() ?? null,
      lastJobId: schedule.lastJobId ?? null,
    }
  })
}

export async function configureInventorySyncSchedule(input: {
  sourceId: string
  enabled: boolean
  expression?: string
  timezone?: string
}) {
  const source = await prisma.inventorySource.findUnique({
    where: { id: input.sourceId },
    select: {
      id: true,
      provider: true,
      adapterType: true,
      enabled: true,
    },
  })
  if (!source) throw new Error('Inventory source was not found.')

  return withJobSystem(async (system) => {
    const key = scheduleKey(input.sourceId)
    if (!input.enabled) {
      await system.unschedule(INVENTORY_SYNC_JOB, key)
      return {
        enabled: false,
        expression: null,
        timezone: null,
        nextRunAt: null,
        lastJobId: null,
      }
    }

    if (!source.enabled) {
      throw new Error('Enable the inventory connection before enabling its schedule.')
    }
    const expression = input.expression?.trim()
    const timezone = input.timezone?.trim() || 'Europe/Amsterdam'
    if (!expression) throw new Error('A recurring schedule expression is required.')

    // Validate before persisting; pg-boss is the authoritative parser.
    system.previewRecurring(expression, timezone)

    await system.scheduleRecurring(
      INVENTORY_SYNC_JOB,
      expression,
      {
        version: 1,
        sourceId: source.id,
        provider: source.provider,
        adapterType: source.adapterType,
      },
      {
        key,
        timezone,
        missed: 'skip',
        correlationKey: `inventory-sync:${source.id}`,
      },
    )

    const preview = system.previewRecurring(expression, timezone)
    const schedule = await system.getSchedule(INVENTORY_SYNC_JOB, key)
    return {
      enabled: true,
      expression,
      timezone,
      nextRunAt: preview[0]?.toISOString() ?? null,
      lastJobId: schedule?.lastJobId ?? null,
    }
  })
}
