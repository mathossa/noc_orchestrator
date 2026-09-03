import { normalizeImportText } from '@/lib/device-import'
import {
  applyDeviceImportRowAction,
  type ImportRowEditField,
} from '@/lib/device-import-staged-rules'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportMappedValues } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

type RepairScope =
  | 'ROWS'
  | 'INVALID_MANAGEMENT_ADDRESS'
  | 'SAME_CUSTOMER_MODEL_AS_ROW'
  | 'SAME_SITE_MODEL_AS_ROW'
type RepairAction = 'SET_FIELD' | 'CLEAR_FIELD' | 'EXCLUDE'

function mappedData(value: unknown): DeviceImportMappedValues {
  return (typeof value === 'object' && value !== null ? value : {}) as DeviceImportMappedValues
}

function rowNumbers(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((row) => Number.isInteger(row) && row > 0))]
    : []
}

async function assertMutableBatch(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true },
  })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
}

export async function applyDeviceImportBlockedRepair(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const scope: RepairScope | null = input.scope === 'ROWS'
    ? 'ROWS'
    : input.scope === 'INVALID_MANAGEMENT_ADDRESS'
      ? 'INVALID_MANAGEMENT_ADDRESS'
      : input.scope === 'SAME_CUSTOMER_MODEL_AS_ROW'
        ? 'SAME_CUSTOMER_MODEL_AS_ROW'
        : input.scope === 'SAME_SITE_MODEL_AS_ROW'
          ? 'SAME_SITE_MODEL_AS_ROW'
          : null
  const action: RepairAction | null = input.action === 'SET_FIELD'
    ? 'SET_FIELD'
    : input.action === 'CLEAR_FIELD'
      ? 'CLEAR_FIELD'
      : input.action === 'EXCLUDE'
        ? 'EXCLUDE'
        : null
  const editField = typeof input.editField === 'string' ? input.editField.trim() as ImportRowEditField : null
  const editValue = typeof input.editValue === 'string' ? input.editValue.trim() : ''
  const selectedRows = rowNumbers(input.rowNumbers)
  const sampleRowNumber = Number(input.sampleRowNumber)

  if (!batchId || !scope || !action) throw new DeviceImportStagingError('Choose a valid blocked-row repair action.')
  await assertMutableBatch(batchId)

  if (scope === 'ROWS') {
    if (!selectedRows.length) throw new DeviceImportStagingError('Select one or more blocked rows first.')
    if (action === 'EXCLUDE') {
      return applyDeviceImportRowAction({ batchId, action: 'EXCLUDE', rowNumbers: selectedRows })
    }
    return applyDeviceImportRowAction({
      batchId,
      action,
      editField,
      editValue,
      rowNumbers: selectedRows,
    })
  }

  const rows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId, status: 'STAGED' },
    select: { rowNumber: true, mappedData: true },
  })

  if (scope === 'INVALID_MANAGEMENT_ADDRESS') {
    if (action !== 'CLEAR_FIELD') throw new DeviceImportStagingError('Invalid Management Address repair only supports clearing the bad source value.')
    const affected = rows
      .filter((row) => {
        const value = mappedData(row.mappedData).managementAddress
        return typeof value === 'string' && value.length > 255
      })
      .map((row) => row.rowNumber)
    if (!affected.length) throw new DeviceImportStagingError('No overlength Management Address values remain in the staged batch.')
    return applyDeviceImportRowAction({
      batchId,
      action: 'CLEAR_FIELD',
      editField: 'managementAddress',
      rowNumbers: affected,
    })
  }

  if (!Number.isInteger(sampleRowNumber) || sampleRowNumber <= 0) {
    throw new DeviceImportStagingError('Choose one representative row before applying a customer/site platform repair.')
  }
  if (action !== 'SET_FIELD' || editField !== 'platform' || !editValue) {
    throw new DeviceImportStagingError('Customer/site platform repair requires a Software Platform value.')
  }

  const sample = rows.find((row) => row.rowNumber === sampleRowNumber)
  if (!sample) throw new DeviceImportStagingError('The selected representative row is no longer staged.')
  const sampleValues = mappedData(sample.mappedData)
  const model = sampleValues.model
  const customer = sampleValues.customer
  const site = sampleValues.site
  if (!model) throw new DeviceImportStagingError('The selected row has no source model value.')
  if (!customer) throw new DeviceImportStagingError('The selected row has no customer value, so a scoped platform choice cannot be applied safely.')
  if (scope === 'SAME_SITE_MODEL_AS_ROW' && !site) {
    throw new DeviceImportStagingError('The selected row has no site value. Choose a customer-scoped platform repair instead.')
  }

  const normalizedModel = normalizeImportText(model)
  const normalizedCustomer = normalizeImportText(customer)
  const normalizedSite = normalizeImportText(site)
  const affected = rows
    .filter((row) => {
      const values = mappedData(row.mappedData)
      if (normalizeImportText(values.model) !== normalizedModel) return false
      if (normalizeImportText(values.customer) !== normalizedCustomer) return false
      if (scope === 'SAME_SITE_MODEL_AS_ROW' && normalizeImportText(values.site) !== normalizedSite) return false
      return true
    })
    .map((row) => row.rowNumber)
  if (!affected.length) throw new DeviceImportStagingError('No staged rows match the selected customer/site and model.')

  return applyDeviceImportRowAction({
    batchId,
    action: 'SET_FIELD',
    editField: 'platform',
    editValue,
    rowNumbers: affected,
  })
}
