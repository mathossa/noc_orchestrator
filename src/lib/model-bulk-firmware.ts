import type { DeviceModelFirmwareReference, DeviceModelRecord } from '@/lib/device-models'
import { isFirmwarePolicyEligible } from '@/lib/firmware-releases'

function normalizePlatform(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function commonCompatibleDesiredReleases(
  models: DeviceModelRecord[],
  releases: DeviceModelFirmwareReference[],
) {
  if (models.length === 0) return []
  const vendorId = models[0].vendorId
  if (models.some((model) => model.vendorId !== vendorId)) return []

  return releases.filter((release) => {
    if (release.vendorId !== vendorId || !isFirmwarePolicyEligible(release)) return false
    const releasePlatform = normalizePlatform(release.platform)

    // A non-empty supported-platform selection is explicit broad compatibility
    // evidence. Do not offer a release when any selected model explicitly
    // excludes its platform. An empty selection remains UNKNOWN, so the target
    // may still be offered for policy intent and the backend will mark it for
    // review or reject more-specific incompatibility evidence.
    return models.every((model) => {
      if (model.supportedPlatforms.length === 0) return true
      return model.supportedPlatforms.some((platform) => normalizePlatform(platform) === releasePlatform)
    })
  })
}

export type DeviceModelCatalogGroupBy = 'none' | 'vendor' | 'deviceType' | 'family'

export function groupDeviceModels(records: DeviceModelRecord[], groupBy: DeviceModelCatalogGroupBy) {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null as string | null, familyId: null as string | null, rows: records }]
  }

  const groups = new Map<
    string,
    { label: string; familyId: string | null; rows: DeviceModelRecord[] }
  >()

  for (const record of records) {
    const key =
      groupBy === 'vendor'
        ? record.vendorId
        : groupBy === 'deviceType'
          ? record.deviceTypeId
          : record.familyId ?? `unassigned:${record.vendorId}`
    const label =
      groupBy === 'vendor'
        ? record.vendor.name
        : groupBy === 'deviceType'
          ? record.deviceType.name
          : record.family?.name ?? `${record.vendor.name} · No family / series`
    const familyId = groupBy === 'family' ? record.familyId : null
    const group = groups.get(key)
    if (group) group.rows.push(record)
    else groups.set(key, { label, familyId, rows: [record] })
  }

  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true }))
}
