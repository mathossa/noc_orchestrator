import { normalizeImportText } from '@/lib/device-import'
import { selectImportedRunningFirmware } from '@/lib/device-import-running-firmware'
import { refreshAffectedReferences } from '@/lib/device-import-staged-rules'
import type { DeviceImportMappedValues } from '@/lib/device-import-staging'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

const RUNNING_FIRMWARE_REPAIR_VERSION = 2
const RUNNING_FIRMWARE_REPAIR_KEY = '_runningFirmwareRepairVersion'

function mappedData(value: unknown) {
  return (
    typeof value === 'object' && value !== null ? value : {}
  ) as DeviceImportMappedValues
}

function settings(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Reinterpret the staged row's effective Current Firmware from the raw source
 * evidence. The function name is retained because existing staged-batch assist
 * code already calls it, but this now repairs more than placeholder values:
 * Cisco ROMMON/bootstrap values and AOS-S boot firmware are also prevented from
 * becoming the canonical running release when Software Version contains the
 * actual running software.
 *
 * This is a legacy/staging-data migration, not normal page-load work. Once a
 * batch has been inspected with this repair version, the marker in batch
 * settings prevents every later /assist GET from rescanning every staged row.
 */
export async function repairPlaceholderDeviceImportFirmware(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, settings: true },
  })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') return { repaired: 0 }

  const batchSettings = settings(batch.settings)
  if (
    batchSettings[RUNNING_FIRMWARE_REPAIR_KEY] ===
    RUNNING_FIRMWARE_REPAIR_VERSION
  )
    return { repaired: 0 }

  const rows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId, status: 'STAGED' },
    select: { id: true, rowNumber: true, mappedData: true },
  })
  const repairs = rows.flatMap((row) => {
    const before = mappedData(row.mappedData)
    const selection = selectImportedRunningFirmware({
      currentFirmware: before.currentFirmware,
      firmwareVersion: before.firmwareVersion,
      softwareVersion: before.softwareVersion,
      vendor: before.vendor,
      model: before.model,
      platform: before.platform,
    })
    const replacement = selection.version
    if (
      normalizeImportText(replacement) === normalizeImportText(before.currentFirmware)
    )
      return []

    return [
      {
        id: row.id,
        rowNumber: row.rowNumber,
        before,
        after: { ...before, currentFirmware: replacement },
      },
    ]
  })

  if (repairs.length) {
    await prisma.$transaction(
      repairs.map((repair) =>
        prisma.deviceImportStagedRow.update({
          where: { id: repair.id },
          data: { mappedData: repair.after },
        }),
      ),
    )
    await refreshAffectedReferences(
      batchId,
      repairs.flatMap((repair) => [
        {
          rowNumber: repair.rowNumber,
          mappedData: repair.before,
          delta: -1 as const,
        },
        {
          rowNumber: repair.rowNumber,
          mappedData: repair.after,
          delta: 1 as const,
        },
      ]),
    )
  }

  await prisma.deviceImportBatch.update({
    where: { id: batchId },
    data: {
      settings: JSON.parse(
        JSON.stringify({
          ...batchSettings,
          [RUNNING_FIRMWARE_REPAIR_KEY]: RUNNING_FIRMWARE_REPAIR_VERSION,
        }),
      ),
    },
  })

  return { repaired: repairs.length }
}
