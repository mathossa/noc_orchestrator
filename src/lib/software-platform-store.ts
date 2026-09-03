import {
  canonicalSoftwarePlatform,
  inferFirmwareTrainName,
} from '@/lib/device-import-normalization'
import { normalizeImportText } from '@/lib/device-import'
import { prisma } from '@/lib/prisma'

export async function ensureSoftwarePlatform(input: {
  vendorId: string
  platform: string
  productFamilyId?: string | null
}) {
  const canonical = canonicalSoftwarePlatform(input.platform)
  const existing = await prisma.softwarePlatform.findUnique({
    where: {
      vendorId_code: { vendorId: input.vendorId, code: canonical.code },
    },
    select: { id: true, code: true, name: true, productFamilyId: true },
  })
  if (existing) {
    const productFamilyId =
      existing.productFamilyId ?? input.productFamilyId ?? null
    return prisma.softwarePlatform.update({
      where: { id: existing.id },
      data: { name: canonical.name, isActive: true, productFamilyId },
      select: { id: true, code: true, name: true, productFamilyId: true },
    })
  }
  return prisma.softwarePlatform.create({
    data: {
      vendorId: input.vendorId,
      productFamilyId: input.productFamilyId ?? null,
      code: canonical.code,
      name: canonical.name,
      isActive: true,
    },
    select: { id: true, code: true, name: true, productFamilyId: true },
  })
}

export async function synchronizeModelSoftwarePlatforms(modelIds: string[]) {
  const uniqueIds = [...new Set(modelIds)]
  if (!uniqueIds.length) return 0
  const models = await prisma.deviceModel.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      vendorId: true,
      familyId: true,
      supportedPlatforms: {
        select: { id: true, platform: true, softwarePlatformId: true },
      },
    },
  })
  let updated = 0
  for (const model of models) {
    for (const entry of model.supportedPlatforms) {
      const softwarePlatform = await ensureSoftwarePlatform({
        vendorId: model.vendorId,
        platform: entry.platform,
        productFamilyId: model.familyId,
      })
      if (entry.softwarePlatformId === softwarePlatform.id) continue
      await prisma.deviceModelPlatform.update({
        where: { id: entry.id },
        data: { softwarePlatformId: softwarePlatform.id },
      })
      updated += 1
    }
  }
  return updated
}

export async function ensureFirmwareTrainForRelease(input: {
  vendorId: string
  platform: string
  version: string
  productFamilyId?: string | null
}) {
  const softwarePlatform = await ensureSoftwarePlatform(input)
  const trainName = inferFirmwareTrainName(input.platform, input.version)
  const compatibleTrains = await prisma.firmwareTrain.findMany({
    where: { vendorId: input.vendorId },
    select: { id: true, softwarePlatformId: true, platform: true, name: true },
  })
  const existing = compatibleTrains.find(
    (train) =>
      sameSoftwarePlatform(train.platform, input.platform) &&
      normalizeImportText(train.name) === normalizeImportText(trainName),
  )
  if (existing) {
    if (existing.softwarePlatformId !== softwarePlatform.id) {
      await prisma.firmwareTrain.update({
        where: { id: existing.id },
        data: { softwarePlatformId: softwarePlatform.id },
      })
    }
    return {
      softwarePlatformId: softwarePlatform.id,
      firmwareTrainId: existing.id,
      trainName,
    }
  }
  const train = await prisma.firmwareTrain.create({
    data: {
      vendorId: input.vendorId,
      softwarePlatformId: softwarePlatform.id,
      platform: input.platform,
      name: trainName,
      notes: 'Inferred from an observed XLSX firmware release.',
      source: 'IMPORT',
      isActive: true,
    },
    select: { id: true },
  })
  return {
    softwarePlatformId: softwarePlatform.id,
    firmwareTrainId: train.id,
    trainName,
  }
}

export function sameSoftwarePlatform(left: string, right: string) {
  return (
    normalizeImportText(canonicalSoftwarePlatform(left).code) ===
    normalizeImportText(canonicalSoftwarePlatform(right).code)
  )
}
