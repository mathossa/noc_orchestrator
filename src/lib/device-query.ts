import type { DeviceContractReference, DeviceFirmwareReference, DeviceRecord, DeviceReferenceData } from '@/lib/devices'
import type { TechnicalFirmwareState } from '@/lib/firmware-state'

export const DEVICE_GROUP_BY = ['none', 'customer', 'site', 'deviceType', 'model'] as const
export type DeviceGroupBy = (typeof DEVICE_GROUP_BY)[number]

export const DEVICE_SORT_FIELDS = ['customer', 'site', 'vendor', 'model', 'deviceType', 'name', 'currentFirmware', 'desiredFirmware', 'technicalState', 'workflow', 'source'] as const
export type DeviceSortField = (typeof DEVICE_SORT_FIELDS)[number]

export const DEVICE_QUERY_PAGE_SIZES = [25, 50, 100] as const
export const DEVICE_TECHNICAL_STATES: TechnicalFirmwareState[] = ['CURRENT', 'ACTION_REQUIRED', 'UNKNOWN', 'NO_POLICY']
export const DEVICE_WORKFLOW_STATES = ['PLANNED', 'IGNORED', 'CUSTOMER_DECLINED', 'DONE', 'UNDECIDED'] as const
export type DeviceWorkflowFilter = (typeof DEVICE_WORKFLOW_STATES)[number]
export const DEVICE_SOURCES = ['MANUAL', 'API', 'IMPORT'] as const
export const DEVICE_ARCHIVE_STATES = ['active', 'archived', 'all'] as const

export type DeviceQuery = {
  q: string
  customer: string
  site: string
  vendor: string
  model: string
  deviceType: string
  contract: string
  currentFirmware: string
  desiredFirmware: string
  technicalState: TechnicalFirmwareState | ''
  workflow: DeviceWorkflowFilter | ''
  source: string
  archive: 'active' | 'archived' | 'all'
  groupBy: DeviceGroupBy
  page: number
  pageSize: number
  sort: DeviceSortField
  direction: 'asc' | 'desc'
}

export type DeviceQueryRecord = DeviceRecord & {
  desiredFirmwareRelease: DeviceFirmwareReference | null
  technicalState: TechnicalFirmwareState
  groupKey: string | null
  groupLabel: string | null
}

export type DeviceQueryGroup = {
  key: string
  label: string
  count: number
}

export type DeviceQueryReferenceData = DeviceReferenceData & {
  vendors: Array<{ id: string; code: string; name: string; isActive: boolean }>
  deviceTypes: Array<{ id: string; code: string; name: string; isActive: boolean }>
  contractTypes: DeviceContractReference[]
}

export type DeviceQueryMeta = DeviceQueryReferenceData & {
  query: DeviceQuery
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    inventoryTotal: number
  }
  groups: DeviceQueryGroup[]
}

export type DeviceQueryPayload = {
  data: DeviceQueryRecord[]
  meta: DeviceQueryMeta
}

export type DeviceQueryFieldErrors = Record<string, string>

export class DeviceQueryValidationError extends Error {
  constructor(
    message: string,
    readonly fields: DeviceQueryFieldErrors,
  ) {
    super(message)
    this.name = 'DeviceQueryValidationError'
  }
}

function cleaned(value: string | null) {
  return (value ?? '').normalize('NFKC').trim()
}

function positiveInteger(value: string | null, fallback: number, field: string, errors: DeviceQueryFieldErrors) {
  if (!value) return fallback
  if (!/^\d+$/.test(value)) {
    errors[field] = 'Enter a positive integer.'
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    errors[field] = 'Enter a positive integer.'
    return fallback
  }
  return parsed
}

export function parseDeviceQuery(params: URLSearchParams): DeviceQuery {
  const errors: DeviceQueryFieldErrors = {}
  const q = cleaned(params.get('q')).slice(0, 200)
  const technicalState = cleaned(params.get('technicalState')).toUpperCase()
  const workflow = cleaned(params.get('workflow')).toUpperCase()
  const source = cleaned(params.get('source')).toUpperCase()
  const archive = cleaned(params.get('archive')) || 'active'
  const groupBy = cleaned(params.get('groupBy')) || 'none'
  const sort = cleaned(params.get('sort')) || 'customer'
  const direction = cleaned(params.get('direction')) || 'asc'
  const page = positiveInteger(params.get('page'), 1, 'page', errors)
  const requestedPageSize = positiveInteger(params.get('pageSize'), 50, 'pageSize', errors)
  const pageSize = DEVICE_QUERY_PAGE_SIZES.includes(requestedPageSize as (typeof DEVICE_QUERY_PAGE_SIZES)[number])
    ? requestedPageSize
    : 50

  if (params.get('pageSize') && pageSize !== requestedPageSize) errors.pageSize = 'Choose page size 25, 50, or 100.'
  if (technicalState && !DEVICE_TECHNICAL_STATES.includes(technicalState as TechnicalFirmwareState)) errors.technicalState = 'Choose CURRENT, ACTION_REQUIRED, UNKNOWN, or NO_POLICY.'
  if (workflow && !DEVICE_WORKFLOW_STATES.includes(workflow as DeviceWorkflowFilter)) errors.workflow = 'Choose a supported workflow state.'
  if (source && !DEVICE_SOURCES.includes(source as (typeof DEVICE_SOURCES)[number])) errors.source = 'Choose MANUAL, API, or IMPORT.'
  if (!DEVICE_ARCHIVE_STATES.includes(archive as (typeof DEVICE_ARCHIVE_STATES)[number])) errors.archive = 'Choose active, archived, or all.'
  if (!DEVICE_GROUP_BY.includes(groupBy as DeviceGroupBy)) errors.groupBy = 'Choose customer, site, deviceType, model, or none.'
  if (!DEVICE_SORT_FIELDS.includes(sort as DeviceSortField)) errors.sort = 'Choose a supported sort field.'
  if (!['asc', 'desc'].includes(direction)) errors.direction = 'Choose asc or desc.'

  if (Object.keys(errors).length > 0) throw new DeviceQueryValidationError('Invalid device query parameters.', errors)

  return {
    q,
    customer: cleaned(params.get('customer')),
    site: cleaned(params.get('site')),
    vendor: cleaned(params.get('vendor')),
    model: cleaned(params.get('model')),
    deviceType: cleaned(params.get('deviceType')),
    contract: cleaned(params.get('contract')),
    currentFirmware: cleaned(params.get('currentFirmware')),
    desiredFirmware: cleaned(params.get('desiredFirmware')),
    technicalState: technicalState as TechnicalFirmwareState | '',
    workflow: workflow as DeviceWorkflowFilter | '',
    source,
    archive: archive as DeviceQuery['archive'],
    groupBy: groupBy as DeviceGroupBy,
    page,
    pageSize,
    sort: sort as DeviceSortField,
    direction: direction as DeviceQuery['direction'],
  }
}

export function deviceQueryHasFilters(query: DeviceQuery) {
  return Boolean(
    query.q || query.customer || query.site || query.vendor || query.model || query.deviceType || query.contract ||
    query.currentFirmware || query.desiredFirmware || query.technicalState || query.workflow || query.source || query.archive !== 'active',
  )
}
