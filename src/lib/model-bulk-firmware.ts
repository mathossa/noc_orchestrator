import type { DeviceModelFirmwareReference, DeviceModelRecord } from '@/lib/device-models'
import { isFirmwarePolicyEligible } from '@/lib/firmware-releases'

export function commonCompatibleDesiredReleases(
  models: DeviceModelRecord[],
  releases: DeviceModelFirmwareReference[],
) {
  if (models.length === 0) return []
  const vendorId = models[0].vendorId
  if (models.some((model) => model.vendorId !== vendorId)) return []

  // #43 deliberately does not use DeviceModel.platform as a compatibility
  // gate. A hardware family/model may support multiple software platforms and
  // a desired track may intentionally migrate from one platform to another.
  // #57 owns exact model/image compatibility. Until then, only expose canonical
  // policy-eligible releases from the same vendor.
  return releases.filter((release) => release.vendorId === vendorId && isFirmwarePolicyEligible(release))
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
