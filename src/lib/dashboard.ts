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

export type DashboardAttentionRow = {
  id: string
  name: string
  context: string
  devices: number
  current: number
  actionRequired: number
  unknown: number
  noPolicy: number
}

export type DashboardVendorComplianceRow = {
  id: string
  name: string
  devices: number
  current: number
  actionRequired: number
  unknown: number
  noPolicy: number
}

export type DashboardFirmwareDistributionRow = {
  id: string
  version: string
  vendor: string
  platform: string
  devices: number
}

export type DashboardWorkflowState = 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'

export type DashboardRecentDecision = {
  id: string
  action: string
  state: DashboardWorkflowState
  deviceId: string
  deviceName: string
  customerId: string | null
  customerName: string | null
  actorName: string | null
  reason: string | null
  notes: string | null
  createdAt: string
}

export type FirmwareLifecycleDashboard = {
  inventory: {
    customers: number
    devices: number
    models: number
    vendors: number
  }
  technical: DashboardTechnicalCounts
  workflow: DashboardWorkflowCounts
  modelsRequiringUpdates: DashboardAttentionRow[]
  customersRequiringUpdates: DashboardAttentionRow[]
  complianceByVendor: DashboardVendorComplianceRow[]
  currentFirmwareDistribution: DashboardFirmwareDistributionRow[]
  recentDecisions: DashboardRecentDecision[]
}
