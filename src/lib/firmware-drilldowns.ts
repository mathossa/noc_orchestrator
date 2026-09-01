import type { TechnicalFirmwareState } from '@/lib/firmware-state'

export type FirmwareWorkflowSummary = {
  planned: number
  ignored: number
  customerDeclined: number
  done: number
  undecided: number
}

export type FirmwareTechnicalSummary = {
  current: number
  actionRequired: number
  unknown: number
  noPolicy: number
}

export type FirmwareSourceSummary = {
  manual: number
  api: number
  import: number
  other: number
  latestSynchronizedAt: string | null
}

export type DrilldownFirmwareReference = {
  id: string
  version: string
  platform: string
  status: string
  isActive: boolean
}

export type VendorDrilldownRecord = {
  id: string
  code: string
  name: string
  websiteUrl: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  deviceCount: number
  modelCount: number
  releaseCount: number
  technicalStateCounts: FirmwareTechnicalSummary
  workflowCounts: FirmwareWorkflowSummary
  sourceSummary: FirmwareSourceSummary
  models: Array<{
    id: string
    model: string
    platform: string | null
    isActive: boolean
    source: string
    lastSynchronizedAt: string | null
    deviceType: { id: string; name: string }
    deviceCount: number
    desiredFirmwareRelease: DrilldownFirmwareReference | null
  }>
  releases: Array<{
    id: string
    platform: string
    version: string
    status: string
    isActive: boolean
    source: string
    lastSynchronizedAt: string | null
    firmwareTrain: { id: string; name: string } | null
    currentDeviceCount: number
    desiredDeviceCount: number
  }>
}

export type ContractDrilldownRecord = {
  id: string
  code: string
  name: string
  description: string | null
  firmwareManagementEnabled: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  defaultCustomerCount: number
  siteOverrideCount: number
  effectiveDeviceCount: number
  technicalStateCounts: FirmwareTechnicalSummary
  workflowCounts: FirmwareWorkflowSummary
  sourceSummary: FirmwareSourceSummary
  customers: Array<{
    id: string
    name: string
    deviceCount: number
  }>
  sites: Array<{
    id: string
    name: string
    customerId: string
    customerName: string
    deviceCount: number
  }>
}

export type DrilldownDeviceFact = {
  currentFirmwareReleaseId: string | null
  desiredFirmwareReleaseId: string | null
  technicalState: TechnicalFirmwareState
  workflowState: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE' | null
}
