export function importerV2CompatibilityRulesFromSupportedPlatforms(
  models: readonly {
    id: string
    model: string
    vendor: { name: string }
  }[],
  supportedPlatformsByModel: ReadonlyMap<string, readonly string[]>,
): Array<{
  id: string
  vendor: string
  model: string
  platforms: string[]
}> {
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
