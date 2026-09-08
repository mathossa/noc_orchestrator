import { prisma } from '@/lib/prisma'
import { FirmwareCompatibilityValidationError } from '@/lib/firmware-compatibility-store'

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function normalize(value: string) {
  return cleanString(value).toLocaleLowerCase('en-US')
}

function cleanPlatforms(value: unknown) {
  if (!Array.isArray(value)) throw new FirmwareCompatibilityValidationError('Supported platforms must be a list.')
  const byNormalized = new Map<string, string>()
  for (const raw of value) {
    const platform = cleanString(raw)
    if (!platform) continue
    if (platform.length > 160) {
      throw new FirmwareCompatibilityValidationError('Each supported platform must be 160 characters or fewer.')
    }
    byNormalized.set(normalize(platform), platform)
  }
  return [...byNormalized.values()]
}

function broadConfiguredRuleWhere(deviceModelId: string) {
  return {
    deviceModelId,
    sourceType: 'CONFIGURED_RULE',
    firmwareTrainId: null,
    logicalVersion: null,
    firmwareReleaseId: null,
    imageCode: null,
  } as const
}

export async function listConfiguredModelSupportedPlatforms(deviceModelIds: string[]) {
  if (deviceModelIds.length === 0) return new Map<string, string[]>()
  const rules = await prisma.firmwareCompatibilityRule.findMany({
    where: {
      deviceModelId: { in: deviceModelIds },
      sourceType: 'CONFIGURED_RULE',
      isActive: true,
      firmwareTrainId: null,
      logicalVersion: null,
      firmwareReleaseId: null,
      imageCode: null,
      decision: 'ALLOW',
    },
    orderBy: [{ platform: 'asc' }, { id: 'asc' }],
    select: { deviceModelId: true, platform: true },
  })
  const result = new Map<string, string[]>()
  for (const rule of rules) {
    if (!rule.deviceModelId) continue
    const values = result.get(rule.deviceModelId)
    if (values) values.push(rule.platform)
    else result.set(rule.deviceModelId, [rule.platform])
  }
  return result
}

export async function syncModelSupportedPlatforms(input: {
  deviceModelId: string
  vendorId: string
  supportedPlatforms: unknown
}) {
  const deviceModelId = cleanString(input.deviceModelId)
  const vendorId = cleanString(input.vendorId)
  const supportedPlatforms = cleanPlatforms(input.supportedPlatforms)
  if (!deviceModelId) throw new FirmwareCompatibilityValidationError('Device model is required.')
  if (!vendorId) throw new FirmwareCompatibilityValidationError('Vendor is required.')

  const [currentRules, releasePlatforms] = await Promise.all([
    prisma.firmwareCompatibilityRule.findMany({
      where: broadConfiguredRuleWhere(deviceModelId),
      select: { id: true, platform: true },
    }),
    prisma.firmwareRelease.findMany({
      where: { vendorId },
      distinct: ['platform'],
      select: { platform: true },
    }),
  ])

  const known = new Map<string, string>()
  for (const platform of [
    ...releasePlatforms.map((row) => row.platform),
    ...currentRules.map((rule) => rule.platform),
    ...supportedPlatforms,
  ]) {
    const cleaned = cleanString(platform)
    if (cleaned) known.set(normalize(cleaned), cleaned)
  }
  const supported = new Set(supportedPlatforms.map(normalize))

  await prisma.$transaction(async (tx) => {
    await tx.firmwareCompatibilityRule.updateMany({
      where: { ...broadConfiguredRuleWhere(deviceModelId), isActive: true },
      data: { isActive: false },
    })

    // Empty means no broad model compatibility decision has been made. Once a
    // non-empty selection exists, it is an allow-list: selected platforms are
    // allowed and other known same-vendor platforms are denied. The evaluator
    // applies the same allow-list semantics to platforms added later.
    if (supportedPlatforms.length === 0) return

    await tx.firmwareCompatibilityRule.createMany({
      data: [...known.entries()].map(([normalizedPlatform, platform]) => ({
        vendorId,
        deviceModelId,
        platform,
        decision: supported.has(normalizedPlatform) ? 'ALLOW' : 'DENY',
        sourceType: 'CONFIGURED_RULE',
        explanation: supported.has(normalizedPlatform)
          ? 'Supported platform selected on the device model.'
          : 'Platform is not selected as supported on the device model.',
        isActive: true,
      })),
    })
  })

  return supportedPlatforms
}
