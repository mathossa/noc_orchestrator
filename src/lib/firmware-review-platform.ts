import { normalizedFirmwarePlatform, type FirmwareReleaseRecord } from '@/lib/firmware-releases'
import type { FirmwareTrainRecord } from '@/lib/firmware-trains'

export type FirmwarePlatformOption = {
  vendorId: string
  platform: string
}

export function sameFirmwarePlatform(left: string, right: string) {
  return normalizedFirmwarePlatform(left) === normalizedFirmwarePlatform(right)
}

export function firmwarePlatformOptionsForVendor<T extends FirmwarePlatformOption>(
  platforms: readonly T[],
  vendorId: string,
) {
  return platforms.filter((platform) => platform.vendorId === vendorId)
}

export function firmwareTrainsForPlatform(
  trains: readonly FirmwareTrainRecord[],
  vendorId: string,
  platform: string,
) {
  return trains.filter(
    (train) =>
      train.isActive &&
      train.vendorId === vendorId &&
      sameFirmwarePlatform(train.platform, platform),
  )
}

export function reviewTrainIdForPlatform(input: {
  release: Pick<FirmwareReleaseRecord, 'platform' | 'firmwareTrainId'>
  selectedPlatform: string
  selectedTrainId?: string
}) {
  if (input.selectedTrainId !== undefined) return input.selectedTrainId
  if (!sameFirmwarePlatform(input.release.platform, input.selectedPlatform)) return ''
  return input.release.firmwareTrainId ?? ''
}

export function reviewPlatformPatch(input: {
  release: Pick<FirmwareReleaseRecord, 'platform' | 'firmwareTrainId'>
  selectedPlatform: string
  selectedTrainId: string
}) {
  const platformChanged = !sameFirmwarePlatform(input.release.platform, input.selectedPlatform)
  const trainChanged = input.selectedTrainId !== (input.release.firmwareTrainId ?? '')

  return {
    ...(platformChanged ? { platform: input.selectedPlatform } : {}),
    ...(platformChanged || trainChanged
      ? { firmwareTrainId: input.selectedTrainId || null }
      : {}),
  }
}
