import { canonicalSoftwarePlatform } from '@/lib/device-import-normalization'
import { normalizeImportText } from '@/lib/device-import'
import { prisma } from '@/lib/prisma'

export type ConfirmedModelNormalization = {
  sourceValue: string
  model: string
  productFamilyId?: string | null
  productFamilyName?: string | null
  softwarePlatforms: string[]
  preferredSoftwarePlatform?: string | null
  deviceTypeName: string
  classificationKey?: string | null
}

export async function rememberConfirmedModelNormalizations(
  batchId: string,
  confirmations: ConfirmedModelNormalization[],
) {
  if (!confirmations.length) return 0
  const batch = await prisma.deviceImportBatch.findUnique({
    where: { id: batchId },
    select: { profileId: true },
  })
  if (!batch?.profileId) return 0

  const familyIds = [
    ...new Set(
      confirmations
        .map((item) => item.productFamilyId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const families = familyIds.length
    ? await prisma.deviceModelFamily.findMany({
        where: { id: { in: familyIds } },
        select: { id: true, name: true },
      })
    : []
  const familyNameById = new Map(
    families.map((family) => [family.id, family.name]),
  )

  let remembered = 0
  for (const item of confirmations) {
    const productFamilyName =
      item.productFamilyName ||
      (item.productFamilyId ? familyNameById.get(item.productFamilyId) : null)
    const platforms = item.softwarePlatforms.map(canonicalSoftwarePlatform)
    if (
      !item.sourceValue ||
      !item.model ||
      !productFamilyName ||
      !platforms.length ||
      !item.deviceTypeName
    )
      continue
    const normalizedValue = normalizeImportText(item.sourceValue)
    const result = {
      classificationKey: item.classificationKey || 'PROFILE_EXACT',
      model: item.model,
      productFamilyName,
      softwarePlatforms: platforms,
      preferredSoftwarePlatformCode: item.preferredSoftwarePlatform
        ? canonicalSoftwarePlatform(item.preferredSoftwarePlatform).code
        : null,
      deviceTypeName: item.deviceTypeName,
    }
    await prisma.deviceImportProfileRule.upsert({
      where: {
        profileId_action_field_operator_normalizedValue: {
          profileId: batch.profileId,
          action: 'NORMALIZE',
          field: 'model',
          operator: 'EQUALS',
          normalizedValue,
        },
      },
      update: {
        value: item.sourceValue,
        result,
        priority: 1_000,
        isActive: true,
      },
      create: {
        profileId: batch.profileId,
        action: 'NORMALIZE',
        field: 'model',
        operator: 'EQUALS',
        value: item.sourceValue,
        normalizedValue,
        result,
        priority: 1_000,
      },
    })
    remembered += 1
  }
  return remembered
}
