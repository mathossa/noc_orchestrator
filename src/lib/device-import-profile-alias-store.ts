import { prisma } from '@/lib/prisma'

const MAX_ALIAS_DELETE = 500

export class DeviceImportProfileAliasError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportProfileAliasError'
  }
}

export async function deleteImportProfileAliases(profileId: string, rawAliasIds: unknown) {
  const aliasIds = Array.isArray(rawAliasIds)
    ? [...new Set(rawAliasIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))]
    : []
  if (!profileId) throw new DeviceImportProfileAliasError('Import profile is required.')
  if (!aliasIds.length) throw new DeviceImportProfileAliasError('Choose at least one learned mapping to forget.')
  if (aliasIds.length > MAX_ALIAS_DELETE) throw new DeviceImportProfileAliasError(`Forget at most ${MAX_ALIAS_DELETE} learned mappings at once.`)

  const profile = await prisma.deviceImportProfile.findUnique({
    where: { id: profileId },
    select: { id: true },
  })
  if (!profile) throw new DeviceImportProfileAliasError('Import profile was not found.')

  const deleted = await prisma.deviceImportProfileAlias.deleteMany({
    where: { profileId, id: { in: aliasIds } },
  })
  return { deleted: deleted.count }
}
