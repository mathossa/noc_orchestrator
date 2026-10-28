import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { normalizedDeviceName } from '@/lib/devices'
import { normalizedFirmwarePlatform } from '@/lib/firmware-releases'
import { supportedFirmwarePlatforms } from '@/lib/firmware-observation'
import type { Prisma } from '../generated/prisma/client'

export type InventoryBulkOperation = 'ARCHIVE' | 'ACTIVATE' | 'SET_CUSTOMER' | 'SET_SITE' | 'SET_MODEL'
export type InventoryBulkItem = { deviceId: string; updatedAt: string }
export type InventoryBulkInput = {
  items: InventoryBulkItem[]
  operation: InventoryBulkOperation
  targetId?: string
}

export class InventoryBulkMaintenanceError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message)
    this.name = 'InventoryBulkMaintenanceError'
  }
}

const selectDevice = {
  id: true, name: true, customerId: true, siteId: true, deviceModelId: true,
  isActive: true, updatedAt: true,
  customer: { select: { name: true } },
  site: { select: { name: true } },
  deviceModel: { select: { model: true, vendorId: true } },
  currentFirmwareRelease: { select: { vendorId: true, platform: true } },
} as const
type DeviceRow = Prisma.DeviceGetPayload<{ select: typeof selectDevice }>
type Tx = Prisma.TransactionClient
type Target = { id: string; name: string; customerId?: string; vendorId?: string; platform?: string | null }

function checkInput(input: unknown): InventoryBulkInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InventoryBulkMaintenanceError('Select devices and an inventory operation.')
  }
  const payload = input as Record<string, unknown>
  const operation = payload.operation
  if (!['ARCHIVE', 'ACTIVATE', 'SET_CUSTOMER', 'SET_SITE', 'SET_MODEL'].includes(String(operation))) {
    throw new InventoryBulkMaintenanceError('Unsupported inventory operation.')
  }
  const items = payload.items
  if (!Array.isArray(items) || items.length < 1 || items.length > 50 ||
    items.some((item) => !item || typeof item !== 'object' ||
      typeof item.deviceId !== 'string' || !item.deviceId ||
      item.deviceId.length > 128 || typeof item.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.updatedAt)))) {
    throw new InventoryBulkMaintenanceError('Select 1–50 devices with their previewed record timestamps.')
  }
  if (new Set(items.map((item) => item.deviceId)).size !== items.length) {
    throw new InventoryBulkMaintenanceError('Duplicate selected devices are not allowed.')
  }
  const targetId = payload.targetId
  if (['SET_CUSTOMER', 'SET_SITE', 'SET_MODEL'].includes(String(operation)) &&
    (typeof targetId !== 'string' || !targetId.trim() || targetId.length > 128)) {
    throw new InventoryBulkMaintenanceError('Select a valid target before previewing.')
  }
  return {
    items,
    operation: operation as InventoryBulkOperation,
    targetId: typeof targetId === 'string' ? targetId : undefined,
  }
}

function nameKey(name: string) {
  return normalizedDeviceName(name)
}

function fingerprint(input: InventoryBulkInput, rows: readonly DeviceRow[], target: Target | null) {
  return createHash('sha256').update(JSON.stringify({
    operation: input.operation, target: target?.id ?? null,
    rows: rows.map((r) => [r.id, r.updatedAt.toISOString(), r.customerId, r.siteId,
      r.deviceModelId, r.isActive, r.name, r.currentFirmwareRelease?.vendorId ?? null,
      r.currentFirmwareRelease?.platform ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  })).digest('hex')
}

async function readPlan(db: Tx | typeof prisma, input: InventoryBulkInput) {
  const rows = await db.device.findMany({
    where: { id: { in: input.items.map((item) => item.deviceId) } },
    select: selectDevice,
  })
  if (rows.length !== input.items.length) {
    throw new InventoryBulkMaintenanceError('A selected device no longer exists. Refresh the inventory.', 409)
  }
  const stamps = new Map(input.items.map((i) => [i.deviceId, i.updatedAt]))
  for (const row of rows) {
    if (row.updatedAt.toISOString() !== stamps.get(row.id)) {
      throw new InventoryBulkMaintenanceError('Selected inventory records have changed. Refresh and preview again.', 409)
    }
  }
  let target: Target | null = null
  if (input.operation === 'SET_CUSTOMER') {
    const customer = await db.customer.findUnique({
      where: { id: input.targetId! }, select: { id: true, name: true, isActive: true },
    })
    if (!customer || !customer.isActive) throw new InventoryBulkMaintenanceError('Target customer is missing or inactive.')
    target = customer
    // Enforce normalized customer-local name uniqueness including cross-batch collisions.
    const siblings = await db.device.findMany({
      where: { customerId: customer.id },
      select: { id: true, name: true },
    })
    const selected = new Set(rows.map((r) => r.id))
    const occupied = new Set(siblings.filter((r) => !selected.has(r.id)).map((r) => nameKey(r.name)))
    const incoming = new Set<string>()
    for (const row of rows) {
      const normalized = nameKey(row.name)
      if (occupied.has(normalized) || incoming.has(normalized)) {
        throw new InventoryBulkMaintenanceError('Target customer already has a device with the same normalized name: ' + row.name)
      }
      incoming.add(normalized)
    }
  } else if (input.operation === 'SET_SITE') {
    const site = await db.site.findUnique({
      where: { id: input.targetId! },
      select: { id: true, name: true, customerId: true, isActive: true },
    })
    if (!site || !site.isActive) throw new InventoryBulkMaintenanceError('Target site is missing or inactive.')
    if (rows.some((r) => r.customerId !== site.customerId)) {
      throw new InventoryBulkMaintenanceError('The selected site must belong to the customer of every selected device.')
    }
    target = site
  } else if (input.operation === 'SET_MODEL') {
    const model = await db.deviceModel.findUnique({
      where: { id: input.targetId! },
      select: { id: true, model: true, vendorId: true, platform: true, isActive: true },
    })
    if (!model || !model.isActive) throw new InventoryBulkMaintenanceError('Target device model is missing or inactive.')
    target = { id: model.id, name: model.model, vendorId: model.vendorId, platform: model.platform }
    const supported = new Set(supportedFirmwarePlatforms(model.platform).map(normalizedFirmwarePlatform))
    for (const row of rows) {
      const firmware = row.currentFirmwareRelease
      if (firmware &&
        (firmware.vendorId !== model.vendorId || !supported.has(normalizedFirmwarePlatform(firmware.platform)))) {
        throw new InventoryBulkMaintenanceError('Model change would make an observed firmware link incompatible for device ' + row.name + '. Correct its canonical firmware link first.')
      }
    }
  }

  const summary = rows.map((row) => {
    const before = input.operation === 'ARCHIVE' || input.operation === 'ACTIVATE'
      ? (row.isActive ? 'Active' : 'Archived')
      : input.operation === 'SET_CUSTOMER' ? row.customer.name
        : input.operation === 'SET_SITE' ? row.site?.name ?? 'No site'
          : row.deviceModel.model
    const after = input.operation === 'ARCHIVE' ? 'Archived'
      : input.operation === 'ACTIVATE' ? 'Active'
        : input.operation === 'SET_SITE' || input.operation === 'SET_CUSTOMER' || input.operation === 'SET_MODEL'
          ? target!.name : before
    const changed = input.operation === 'ARCHIVE' ? row.isActive :
      input.operation === 'ACTIVATE' ? !row.isActive :
        input.operation === 'SET_CUSTOMER' ? row.customerId !== target?.id :
          input.operation === 'SET_SITE' ? row.siteId !== target?.id :
            row.deviceModelId !== target?.id
    return {
      deviceId: row.id, deviceName: row.name, customerName: row.customer.name,
      before, after, changed,
      note: input.operation === 'SET_CUSTOMER' && changed && row.siteId
        ? 'Existing site will be cleared because it belongs to the original customer.' : null,
    }
  })
  return {
    rows: summary,
    changedCount: summary.filter((r) => r.changed).length,
    skippedCount: summary.filter((r) => !r.changed).length,
    fingerprint: fingerprint(input, rows, target),
    originals: rows,
    target,
  }
}

export async function previewInventoryBulkMaintenance(rawInput: unknown) {
  const input = checkInput(rawInput)
  const plan = await readPlan(prisma, input)
  return {
    items: plan.rows,
    changedCount: plan.changedCount,
    skippedCount: plan.skippedCount,
    fingerprint: plan.fingerprint,
    operation: input.operation,
    targetId: plan.target?.id ?? null,
  }
}

export async function applyInventoryBulkMaintenance(rawInput: unknown, actorUserId: string) {
  const request = rawInput as Record<string, unknown> | null
  if (!request || request.confirmed !== true || typeof request.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.fingerprint)) {
    throw new InventoryBulkMaintenanceError('Preview and explicitly confirm the proposed changes first.')
  }
  const input = checkInput(request)
  return prisma.$transaction(async (tx) => {
    const plan = await readPlan(tx, input)
    if (plan.fingerprint !== request.fingerprint) {
      throw new InventoryBulkMaintenanceError('Preview is stale. Review the change again.', 409)
    }
    const changedIds = new Set(plan.rows.filter((row) => row.changed).map((r) => r.deviceId))
    const batchId = randomUUID()
    for (const device of plan.originals) {
      if (!changedIds.has(device.id)) continue
      const data =
        input.operation === 'ARCHIVE' ? { isActive: false } :
        input.operation === 'ACTIVATE' ? { isActive: true } :
        input.operation === 'SET_CUSTOMER' ? { customerId: plan.target!.id, siteId: null } :
        input.operation === 'SET_SITE' ? { siteId: plan.target!.id } :
        { deviceModelId: plan.target!.id }
      const updated = await tx.device.updateMany({
        where: { id: device.id, updatedAt: device.updatedAt },
        data,
      })
      if (updated.count !== 1) throw new InventoryBulkMaintenanceError('Concurrent device change. Nothing was committed.', 409)
      const after = await tx.device.findUniqueOrThrow({
        where: { id: device.id },
        select: { customerId: true, siteId: true, deviceModelId: true, isActive: true },
      })
      await tx.auditEvent.create({
        data: {
          entityType: 'Device', entityId: device.id, actorUserId,
          customerId: after.customerId,
          action: 'INVENTORY_BULK_' + input.operation,
          before: {
            customerId: device.customerId, siteId: device.siteId,
            deviceModelId: device.deviceModelId, isActive: device.isActive,
          },
          after,
          metadata: { batchId, operation: input.operation, targetId: plan.target?.id ?? null },
        },
      })
    }
    return { updated: changedIds.size, skipped: plan.skippedCount, batchId }
  }, { isolationLevel: 'Serializable' })
}

export async function listInventoryBulkReferences() {
  const [customers, sites, models] = await Promise.all([
    prisma.customer.findMany({
      where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' },
    }),
    prisma.site.findMany({
      where: { isActive: true }, select: { id: true, name: true, customerId: true, customer: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.deviceModel.findMany({
      where: { isActive: true }, select: { id: true, model: true, vendor: { select: { name: true } } },
      orderBy: { model: 'asc' },
    }),
  ])
  return { customers, sites: sites.map((s) => ({
    id: s.id, name: s.name, customerId: s.customerId, label: s.customer.name + ' / ' + s.name,
  })), models: models.map((m) => ({ id: m.id, name: m.model, label: m.vendor.name + ' / ' + m.model })) }
}
