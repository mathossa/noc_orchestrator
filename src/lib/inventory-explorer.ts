import {
  INVENTORY_PRIMARY_STATUS_CODES,
  type InventoryPrimaryStatusCode,
} from '@/lib/inventory-status'

export const INVENTORY_PAGE_SIZES = [25, 50, 100] as const
export const INVENTORY_SOURCES = ['MANUAL', 'API', 'IMPORT'] as const

export type InventoryQuery = {
  q: string
  vendor: string
  model: string
  deviceType: string
  contract: string
  source: string
  status: InventoryPrimaryStatusCode | ''
  attention: boolean
  page: number
  pageSize: number
}

export type InventoryFilterOptions = {
  vendors: Array<{ id: string; name: string }>
  models: Array<{ id: string; model: string; vendorName: string }>
  deviceTypes: Array<{ id: string; name: string }>
  contracts: Array<{ id: string; name: string }>
}

export type InventoryCounts = {
  total: number
  attention: number
  unknown: number
  critical: number
}

export type InventoryCustomerRow = {
  id: string
  name: string
  siteCount: number
  deviceCount: number
  attentionCount: number
  highestStatus: InventoryPrimaryStatusCode | null
}

export type InventorySiteRow = {
  id: string
  name: string
  deviceCount: number
  attentionCount: number
  highestStatus: InventoryPrimaryStatusCode | null
}

export type InventoryDeviceTypeRow = {
  id: string
  name: string
  deviceCount: number
  attentionCount: number
  highestStatus: InventoryPrimaryStatusCode | null
}

export type InventoryDeviceRow = {
  id: string
  name: string
  hostname: string | null
  model: string
  currentFirmware: string | null
  status: import('@/lib/inventory-status').InventoryPrimaryStatus
  customer: { id: string; name: string }
  site: { id: string; name: string } | null
  deviceType: { id: string; name: string }
}

export type InventoryPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type InventoryOverviewModel = {
  counts: InventoryCounts
  customers: InventoryCustomerRow[]
  searchHits: InventoryDeviceRow[]
  filters: InventoryFilterOptions
}

export type CustomerInventoryModel = {
  customer: { id: string; name: string }
  counts: InventoryCounts
  sites: InventorySiteRow[]
  searchHits: InventoryDeviceRow[]
  filters: InventoryFilterOptions
}

export type SiteInventoryModel = {
  customer: { id: string; name: string }
  site: { id: string; name: string; unassigned: boolean }
  counts: InventoryCounts
  deviceTypes: InventoryDeviceTypeRow[]
  searchHits: InventoryDeviceRow[]
  filters: InventoryFilterOptions
}

export type DeviceTypeInventoryModel = {
  customer: { id: string; name: string }
  site: { id: string; name: string; unassigned: boolean }
  deviceType: { id: string; name: string }
  counts: InventoryCounts
  devices: InventoryDeviceRow[]
  pagination: InventoryPagination
  filters: InventoryFilterOptions
}

function text(value: string | null) {
  return (value ?? '').normalize('NFKC').trim()
}

function positiveInteger(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseInventoryQuery(params: URLSearchParams): InventoryQuery {
  const requestedPageSize = positiveInteger(params.get('pageSize'), 25)
  const pageSize = INVENTORY_PAGE_SIZES.includes(
    requestedPageSize as (typeof INVENTORY_PAGE_SIZES)[number],
  )
    ? requestedPageSize
    : 25
  const status = text(params.get('status')).toUpperCase()
  const source = text(params.get('source')).toUpperCase()

  return {
    q: text(params.get('q')).slice(0, 200),
    vendor: text(params.get('vendor')),
    model: text(params.get('model')),
    deviceType: text(params.get('deviceType')),
    contract: text(params.get('contract')),
    source: INVENTORY_SOURCES.includes(
      source as (typeof INVENTORY_SOURCES)[number],
    )
      ? source
      : '',
    status: INVENTORY_PRIMARY_STATUS_CODES.includes(
      status as InventoryPrimaryStatusCode,
    )
      ? (status as InventoryPrimaryStatusCode)
      : '',
    attention: params.get('attention') === '1',
    page: positiveInteger(params.get('page'), 1),
    pageSize,
  }
}

export function searchParamsToUrlSearchParams(
  values: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else if (value !== undefined) {
      params.set(key, value)
    }
  }
  return params
}

export function inventoryHref(
  path: string,
  query: InventoryQuery,
  patch: Partial<InventoryQuery> = {},
) {
  const next = { ...query, ...patch }
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.vendor) params.set('vendor', next.vendor)
  if (next.model) params.set('model', next.model)
  if (next.deviceType) params.set('deviceType', next.deviceType)
  if (next.contract) params.set('contract', next.contract)
  if (next.source) params.set('source', next.source)
  if (next.status) params.set('status', next.status)
  if (next.attention) params.set('attention', '1')
  if (next.page > 1) params.set('page', String(next.page))
  if (next.pageSize !== 25) params.set('pageSize', String(next.pageSize))
  const serialized = params.toString()
  return serialized ? path + '?' + serialized : path
}
