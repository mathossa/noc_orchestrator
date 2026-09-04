export type AuditJsonScalar = string | number | boolean | null
export type AuditSnapshot = Record<string, AuditJsonScalar>

export type AuditEventRecord = {
  id: string
  action: string
  entityType: string
  entityId: string
  customerId: string | null
  actorUserId: string | null
  actor: { id: string; name: string; email: string } | null
  before: AuditSnapshot | null
  after: AuditSnapshot | null
  metadata: AuditSnapshot | null
  createdAt: string
}

export const AUDIT_ACTIONS = {
  desiredFirmwareChanged: 'DESIRED_FIRMWARE_CHANGED',
  desiredFirmwareCleared: 'DESIRED_FIRMWARE_CLEARED',
  currentFirmwareChanged: 'CURRENT_FIRMWARE_CHANGED',
  firmwareCompatibilityOverrideChanged: 'FIRMWARE_COMPATIBILITY_OVERRIDE_CHANGED',
  firmwareCompatibilityOverrideCleared: 'FIRMWARE_COMPATIBILITY_OVERRIDE_CLEARED',
  lifecyclePlanned: 'FIRMWARE_LIFECYCLE_PLANNED',
  lifecycleIgnored: 'FIRMWARE_LIFECYCLE_IGNORED',
  lifecycleCustomerDeclined: 'FIRMWARE_LIFECYCLE_CUSTOMER_DECLINED',
  lifecycleDone: 'FIRMWARE_LIFECYCLE_DONE',
} as const

export function auditActionLabel(action: string) {
  switch (action) {
    case AUDIT_ACTIONS.desiredFirmwareChanged:
      return 'Desired firmware changed'
    case AUDIT_ACTIONS.desiredFirmwareCleared:
      return 'Desired firmware cleared'
    case AUDIT_ACTIONS.currentFirmwareChanged:
      return 'Current firmware changed'
    case AUDIT_ACTIONS.firmwareCompatibilityOverrideChanged:
      return 'Firmware compatibility override changed'
    case AUDIT_ACTIONS.firmwareCompatibilityOverrideCleared:
      return 'Firmware compatibility override cleared'
    case AUDIT_ACTIONS.lifecyclePlanned:
      return 'Marked planned'
    case AUDIT_ACTIONS.lifecycleIgnored:
      return 'Marked ignored'
    case AUDIT_ACTIONS.lifecycleCustomerDeclined:
      return 'Customer decline recorded'
    case AUDIT_ACTIONS.lifecycleDone:
      return 'Marked done'
    default:
      return action.replaceAll('_', ' ').toLocaleLowerCase('en-US')
  }
}
