export type DashboardTechnicalCounts = {
  current: number
  actionRequired: number
  unknown: number
  noPolicy: number
}

export type DashboardWorkflowCounts = {
  planned: number
  ignored: number
  customerDeclined: number
  done: number
  undecided: number
}

export type DashboardSiteAttentionRow = {
  id: string | null
  name: string
  actionRequired: number
  unknown: number
  noPolicy: number
}

export type DashboardCustomerAttentionRow = {
  id: string
  name: string
  actionRequired: number
  unknown: number
  noPolicy: number
  sites: DashboardSiteAttentionRow[]
}

export type DashboardDimensionAttentionRow = {
  id: string | null
  name: string
  devices: number
  actionRequired: number
  unknown: number
  noPolicy: number
  blocked: number
}

export type DashboardFirmwareAttentionRow = {
  id: string
  version: string
  vendor: string
  platform: string
  status: string
  devices: number
  actionRequired: number
  blocked: number
}

export type DashboardWorkflowState = 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'

export type FirmwareLifecycleDashboard = {
  activeDevices: number
  technical: DashboardTechnicalCounts
  workflow: DashboardWorkflowCounts
  customerAttention: DashboardCustomerAttentionRow[]
  contractAttention: DashboardDimensionAttentionRow[]
  vendorAttention: DashboardDimensionAttentionRow[]
  firmwareAttention: DashboardFirmwareAttentionRow[]
}
