import { prisma } from '@/lib/prisma'
import {
  buildImporterV2SourceProfile,
  type ImporterV2SourceProfile,
} from '@/lib/importer-v2-source-profiles'

type StoredProfile = {
  id: string
  name: string
  version: string
  isActive: boolean
  schemaFingerprint: string
  provider: string
  sourceAdapterId: string
  sheetName: string
  headerRow: number
  headers: unknown
  columnMappings: unknown
  hierarchyTemplate: unknown
  deviceTypePolicy: unknown
  defaults: unknown
  exactValueAliases: unknown
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function serialize(record: StoredProfile): ImporterV2SourceProfile {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    isActive: record.isActive,
    schemaFingerprint: record.schemaFingerprint,
    provider: record.provider,
    sourceAdapterId: record.sourceAdapterId,
    sheetName: record.sheetName,
    headerRow: record.headerRow,
    headers: record.headers as ImporterV2SourceProfile['headers'],
    columnMappings:
      record.columnMappings as ImporterV2SourceProfile['columnMappings'],
    hierarchyTemplate:
      record.hierarchyTemplate as ImporterV2SourceProfile['hierarchyTemplate'],
    deviceTypePolicy:
      record.deviceTypePolicy as ImporterV2SourceProfile['deviceTypePolicy'],
    defaults: record.defaults as ImporterV2SourceProfile['defaults'],
    exactValueAliases:
      record.exactValueAliases as ImporterV2SourceProfile['exactValueAliases'],
  }
}

function persistenceData(profile: ImporterV2SourceProfile) {
  return {
    name: profile.name,
    version: profile.version,
    isActive: profile.isActive,
    schemaFingerprint: profile.schemaFingerprint,
    provider: profile.provider,
    sourceAdapterId: profile.sourceAdapterId,
    sheetName: profile.sheetName,
    headerRow: profile.headerRow,
    headers: jsonValue(profile.headers),
    columnMappings: jsonValue(profile.columnMappings),
    hierarchyTemplate: jsonValue(profile.hierarchyTemplate),
    deviceTypePolicy: jsonValue(profile.deviceTypePolicy),
    defaults: jsonValue(profile.defaults),
    exactValueAliases: jsonValue(profile.exactValueAliases),
  }
}

export async function listActiveImporterV2SourceProfiles() {
  const records = await prisma.importerV2SourceProfile.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  return records.map(serialize)
}

export async function createImporterV2SourceProfile(
  input: Omit<ImporterV2SourceProfile, 'schemaFingerprint'>,
) {
  const profile = buildImporterV2SourceProfile(input)
  const record = await prisma.importerV2SourceProfile.create({
    data: { id: profile.id, ...persistenceData(profile) },
  })
  return serialize(record)
}

export async function updateImporterV2SourceProfile(
  id: string,
  input: Omit<ImporterV2SourceProfile, 'id' | 'schemaFingerprint'>,
) {
  const profile = buildImporterV2SourceProfile({ id, ...input })
  const record = await prisma.importerV2SourceProfile.update({
    where: { id },
    data: persistenceData(profile),
  })
  return serialize(record)
}
