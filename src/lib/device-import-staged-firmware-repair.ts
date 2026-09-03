import {
  extractFirmwareVersion,
  isPlaceholderFirmwareVersion,
} from '@/lib/device-import'
import { refreshAffectedReferences } from '@/lib/device-import-staged-rules'
import type { DeviceImportMappedValues } from '@/lib/device-import-staging'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

function mappedData(value: unknown) {
  return (
    typeof value === 'object' && value !== null ? value : {}
  ) as DeviceImportMappedValues
}

export async function repairPlaceholderDeviceImportFirmware(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true },
  })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') return { repaired: 0 }

  const rows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId, status: 'STAGED' },
    select: { id: true, rowNumber: true, mappedData: true },
  })
  const repairs = rows.flatMap((row) => {
    const before = mappedData(row.mappedData)
    if (!isPlaceholderFirmwareVersion(before.currentFirmware)) return []
    const softwareFirmware = extractFirmwareVersion(before.softwareVersion)
    if (!softwareFirmware || isPlaceholderFirmwareVersion(softwareFirmware))
      return []
    return [
      {
        id: row.id,
        rowNumber: row.rowNumber,
        before,
        after: { ...before, currentFirmware: softwareFirmware },
      },
    ]
  })
  if (!repairs.length) return { repaired: 0 }

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
  return { repaired: repairs.length }
}
