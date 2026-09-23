import type { DeviceDetailRecord } from '@/lib/devices'

/** Short operational copy over canonical results, not another evaluator. */
export function deviceFirmwareSummary(
  device: Pick<DeviceDetailRecord, 'inventoryStatus' | 'firmwareCompliance'>,
) {
  const { inventoryStatus: status, firmwareCompliance: firmware } = device
  if (status.code === 'CRITICAL_ATTENTION') {
    if (firmware.compliance === 'BLOCKED_RELEASE')
      return 'Current release is blocked. Review the replacement with the site maintenance plan.'
    if (firmware.compliance === 'INCOMPATIBLE')
      return 'Current firmware is incompatible with this model. Investigate before maintenance.'
    return 'The target firmware is incompatible. Review the policy before maintenance.'
  }
  if (status.code === 'CURRENT') return 'Firmware is up to date.'
  if (status.code === 'EXCEPTION')
    return 'An accepted exception applies to this device.'
  if (status.code === 'UPDATE_REQUIRED')
    return firmware.compliance === 'BELOW_MINIMUM'
      ? 'Below the minimum acceptable release. Include in site maintenance.'
      : 'Firmware is outside the permitted policy. Include in site maintenance.'
  if (status.code === 'UPDATE_RECOMMENDED')
    return firmware.recommendation === 'PLATFORM_MIGRATION'
      ? 'A platform migration is recommended. Review with the site maintenance plan.'
      : 'Update available. Include in the next site maintenance.'
  if (status.code === 'REVIEW_REQUIRED')
    return 'Review the firmware or exception details before planning maintenance.'
  return 'Firmware status is unknown. Review the observation and policy details.'
}
