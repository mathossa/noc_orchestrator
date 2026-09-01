import {
  DEVICE_IMPORT_REFERENCE_KINDS,
  importResolutionKey,
  normalizeImportText,
  type DeviceImportReferenceKind,
} from '@/lib/device-import'
import { prisma } from '@/lib/prisma'

export class DeviceImportReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportReferenceError'
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function parseKind(value: unknown): DeviceImportReferenceKind {
  if (typeof value !== 'string' || !DEVICE_IMPORT_REFERENCE_KINDS.includes(value as DeviceImportReferenceKind)) {
    throw new DeviceImportReferenceError('Choose a supported import reference type.')
  }
  return value as DeviceImportReferenceKind
}

export async function saveImportReferenceAlias(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const kind = parseKind(input.kind)
  const sourceValue = cleanText(input.sourceValue)
  const targetId = cleanText(input.targetId)
  const requestedContext = cleanText(input.contextKey)

  if (!sourceValue) throw new DeviceImportReferenceError('The spreadsheet value to remember is required.')
  if (!targetId) throw new DeviceImportReferenceError('Choose the configured record this value should match.')

  let contextKey = ''
  let targetLabel = ''

  if (kind === 'DEVICE_TYPE') {
    const target = await prisma.deviceType.findUnique({ where: { id: targetId }, select: { id: true, name: true, isActive: true } })
    if (!target) throw new DeviceImportReferenceError('The selected device type no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived device types cannot be used for a new import alias.')
    targetLabel = target.name
  } else {
    const target = await prisma.deviceModel.findUnique({
      where: { id: targetId },
      select: { id: true, model: true, vendorId: true, isActive: true, vendor: { select: { name: true } } },
    })
    if (!target) throw new DeviceImportReferenceError('The selected device model no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived device models cannot be used for a new import alias.')
    if (requestedContext && requestedContext !== target.vendorId) {
      throw new DeviceImportReferenceError('The selected model belongs to a different vendor than this spreadsheet value.')
    }
    contextKey = target.vendorId
    targetLabel = `${target.vendor.name} · ${target.model}`
  }

  const normalizedSourceValue = normalizeImportText(sourceValue)
  const record = await prisma.importReferenceAlias.upsert({
    where: {
      kind_normalizedSourceValue_contextKey: {
        kind,
        normalizedSourceValue,
        contextKey,
      },
    },
    create: { kind, sourceValue, normalizedSourceValue, contextKey, targetId },
    update: { sourceValue, targetId },
    select: { id: true, kind: true, sourceValue: true, normalizedSourceValue: true, contextKey: true, targetId: true },
  })

  return {
    ...record,
    key: importResolutionKey(kind, sourceValue, contextKey),
    targetLabel,
  }
}

export async function listDeviceImportReferenceOptions() {
  const [vendors, deviceTypes, models, families] = await Promise.all([
    prisma.vendor.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.deviceType.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.deviceModel.findMany({
      orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { model: 'asc' }],
      select: {
        id: true,
        vendorId: true,
        deviceTypeId: true,
        familyId: true,
        model: true,
        platform: true,
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
        deviceType: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    prisma.deviceModelFamily.findMany({
      orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { name: 'asc' }],
      select: { id: true, vendorId: true, name: true, isActive: true },
    }),
  ])

  return { vendors, deviceTypes, models, families }
}
