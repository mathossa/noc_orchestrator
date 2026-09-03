import {
  DEVICE_IMPORT_REFERENCE_KINDS,
  importResolutionKey,
  normalizeImportText,
  type DeviceImportReferenceKind,
} from '@/lib/device-import'
import { normalizedPlatform } from '@/lib/devices'
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

async function validateAliasTarget(kind: DeviceImportReferenceKind, targetId: string, requestedContext: string) {
  if (kind === 'CUSTOMER') {
    const target = await prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, name: true, isActive: true } })
    if (!target) throw new DeviceImportReferenceError('The selected customer no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived customers cannot be used for a new import alias.')
    return { contextKey: '', targetLabel: target.name }
  }

  if (kind === 'SITE') {
    const target = await prisma.site.findUnique({ where: { id: targetId }, select: { id: true, name: true, customerId: true, isActive: true } })
    if (!target) throw new DeviceImportReferenceError('The selected site no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived sites cannot be used for a new import alias.')
    if (!requestedContext || requestedContext !== target.customerId) {
      throw new DeviceImportReferenceError('The selected site belongs to a different customer than this spreadsheet value.')
    }
    return { contextKey: target.customerId, targetLabel: target.name }
  }

  if (kind === 'VENDOR') {
    const target = await prisma.vendor.findUnique({ where: { id: targetId }, select: { id: true, name: true, isActive: true } })
    if (!target) throw new DeviceImportReferenceError('The selected vendor no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived vendors cannot be used for a new import alias.')
    return { contextKey: '', targetLabel: target.name }
  }

  if (kind === 'DEVICE_TYPE') {
    const target = await prisma.deviceType.findUnique({ where: { id: targetId }, select: { id: true, name: true, isActive: true } })
    if (!target) throw new DeviceImportReferenceError('The selected device type no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived device types cannot be used for a new import alias.')
    return { contextKey: '', targetLabel: target.name }
  }

  if (kind === 'DEVICE_MODEL') {
    const target = await prisma.deviceModel.findUnique({
      where: { id: targetId },
      select: { id: true, model: true, vendorId: true, isActive: true, vendor: { select: { name: true } } },
    })
    if (!target) throw new DeviceImportReferenceError('The selected device model no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived device models cannot be used for a new import alias.')
    if (requestedContext && requestedContext !== target.vendorId) {
      throw new DeviceImportReferenceError('The selected model belongs to a different vendor than this spreadsheet value.')
    }
    return { contextKey: target.vendorId, targetLabel: `${target.vendor.name} · ${target.model}` }
  }

  if (kind === 'CONTRACT_TYPE') {
    const target = await prisma.contractType.findUnique({ where: { id: targetId }, select: { id: true, name: true, isActive: true } })
    if (!target) throw new DeviceImportReferenceError('The selected contract type no longer exists.')
    if (!target.isActive) throw new DeviceImportReferenceError('Archived contract types cannot be used for a new import alias.')
    return { contextKey: '', targetLabel: target.name }
  }

  const target = await prisma.firmwareRelease.findUnique({
    where: { id: targetId },
    select: { id: true, version: true, vendorId: true, platform: true, isActive: true, vendor: { select: { name: true } } },
  })
  if (!target) throw new DeviceImportReferenceError('The selected firmware release no longer exists.')
  if (!target.isActive) throw new DeviceImportReferenceError('Archived firmware releases cannot be used for a new import alias.')
  const expectedContext = `${target.vendorId}|${normalizedPlatform(target.platform)}`
  if (requestedContext && requestedContext !== expectedContext) {
    throw new DeviceImportReferenceError('The selected firmware release is not compatible with the vendor/platform context of this value.')
  }
  return { contextKey: expectedContext, targetLabel: `${target.vendor.name} · ${target.version}` }
}

export async function saveImportReferenceAlias(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const kind = parseKind(input.kind)
  const sourceValue = cleanText(input.sourceValue)
  const targetId = cleanText(input.targetId)
  const requestedContext = cleanText(input.contextKey)
  const profileId = cleanText(input.profileId) || null

  if (!sourceValue) throw new DeviceImportReferenceError('The spreadsheet value to remember is required.')
  if (!targetId) throw new DeviceImportReferenceError('Choose the configured record this value should match.')

  if (profileId) {
    const profile = await prisma.deviceImportProfile.findUnique({ where: { id: profileId }, select: { id: true, isActive: true } })
    if (!profile || !profile.isActive) throw new DeviceImportReferenceError('The selected import profile no longer exists or is archived.')
  }

  const { contextKey, targetLabel } = await validateAliasTarget(kind, targetId, requestedContext)
  const normalizedSourceValue = normalizeImportText(sourceValue)

  const record = profileId
    ? await prisma.deviceImportProfileAlias.upsert({
        where: {
          profileId_kind_normalizedSourceValue_contextKey: {
            profileId,
            kind,
            normalizedSourceValue,
            contextKey,
          },
        },
        create: { profileId, kind, sourceValue, normalizedSourceValue, contextKey, targetId },
        update: { sourceValue, targetId },
        select: { id: true, kind: true, sourceValue: true, normalizedSourceValue: true, contextKey: true, targetId: true },
      })
    : await prisma.importReferenceAlias.upsert({
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
    profileId,
    key: importResolutionKey(kind, sourceValue, contextKey),
    targetLabel,
  }
}

export async function listDeviceImportReferenceOptions() {
  const [vendors, deviceTypes, models, families, contracts, firmwareReleases] = await Promise.all([
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
    prisma.contractType.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.firmwareRelease.findMany({
      orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { platform: 'asc' }, { version: 'asc' }],
      select: {
        id: true,
        vendorId: true,
        platform: true,
        version: true,
        status: true,
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
  ])

  return { vendors, deviceTypes, models, families, contracts, firmwareReleases }
}
