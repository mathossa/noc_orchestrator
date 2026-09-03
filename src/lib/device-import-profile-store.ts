import {
  parseDeviceImportOptions,
  type DeviceImportProfileSettings,
} from '@/lib/device-import'
import { prisma } from '@/lib/prisma'

export type DeviceImportProfileRecord = {
  id: string
  name: string
  externalProvider: string | null
  settings: DeviceImportProfileSettings
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export class DeviceImportProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportProfileError'
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function profileSettings(value: unknown): DeviceImportProfileSettings {
  const input = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const parsed = parseDeviceImportOptions({
    ...input,
    profileId: null,
    resolutions: {},
  })
  return {
    sheetName: parsed.sheetName,
    headerRow: parsed.headerRow,
    mapping: parsed.mapping,
    defaults: parsed.defaults,
    organizationSiteDelimiter: parsed.organizationSiteDelimiter,
  }
}

function serializeProfile(record: {
  id: string
  name: string
  externalProvider: string | null
  settings: unknown
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}): DeviceImportProfileRecord {
  return {
    id: record.id,
    name: record.name,
    externalProvider: record.externalProvider,
    settings: profileSettings(record.settings),
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function listDeviceImportProfiles() {
  const records = await prisma.deviceImportProfile.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  return records.map(serializeProfile)
}

export async function saveDeviceImportProfile(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const id = cleanText(input.id)
  const name = cleanText(input.name)
  const externalProvider = cleanText(input.externalProvider) || null
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : true
  const settings = profileSettings(input.settings)

  if (!name) throw new DeviceImportProfileError('Import profile name is required.')
  if (name.length > 120) throw new DeviceImportProfileError('Import profile name must be 120 characters or fewer.')
  if (externalProvider && externalProvider.length > 120) {
    throw new DeviceImportProfileError('External provider must be 120 characters or fewer.')
  }

  const duplicate = await prisma.deviceImportProfile.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) },
    select: { id: true },
  })
  if (duplicate) throw new DeviceImportProfileError(`An import profile named “${name}” already exists.`)

  const record = id
    ? await prisma.deviceImportProfile.update({
        where: { id },
        data: { name, externalProvider, settings, isActive },
      })
    : await prisma.deviceImportProfile.create({
        data: { name, externalProvider, settings, isActive },
      })

  return serializeProfile(record)
}
