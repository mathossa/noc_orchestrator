import { DeviceImportProfileRuleError } from '@/lib/device-import-profile-rule-store'
import { prisma } from '@/lib/prisma'

export async function updateImportProfileRulePriority(
  profileId: string,
  ruleId: string,
  priority: unknown,
) {
  if (!Number.isInteger(priority) || Number(priority) < 0 || Number(priority) > 10_000) {
    throw new DeviceImportProfileRuleError('Rule priority must be a whole number between 0 and 10000.')
  }
  const existing = await prisma.deviceImportProfileRule.findFirst({
    where: { id: ruleId, profileId },
    select: { id: true },
  })
  if (!existing) throw new DeviceImportProfileRuleError('Import rule was not found.')
  return prisma.deviceImportProfileRule.update({
    where: { id: ruleId },
    data: { priority: Number(priority) },
    select: { id: true, priority: true },
  })
}
