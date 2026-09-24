import type { ImporterV2FirmwareCompatibilityRule } from '@/lib/importer-v2-firmware'

export function importerV2CompatibilityRulesFromSupportedPlatforms(
  models: readonly {
    id: string
    model: string
    vendor: { name: string }
  }[],
  supportedPlatformsByModel: ReadonlyMap<string, readonly string[]>,
): ImporterV2FirmwareCompatibilityRule[] {
  return models.flatMap((record) => {
    const platforms = [...(supportedPlatformsByModel.get(record.id) ?? [])]
    return platforms.length
      ? [
          {
            id: `device-model:${record.id}`,
            vendor: record.vendor.name,
            model: record.model,
            platforms,
          },
        ]
      : []
  })
}
