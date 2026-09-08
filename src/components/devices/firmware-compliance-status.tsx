import { StatusBadge } from '@/components/ui/status-badge'
import {
  firmwareComplianceLabel,
  type FirmwareComplianceResult,
} from '@/lib/firmware-compliance'

export function FirmwareComplianceStatus({
  result,
}: {
  result: FirmwareComplianceResult
}) {
  const tone =
    result.compliance === 'BLOCKED_RELEASE' ||
    result.compliance === 'INCOMPATIBLE'
      ? 'danger'
      : result.recommendation === 'NO_ACTION'
        ? 'success'
        : 'warning'
  return (
    <span
      title={[
        result.explanation,
        result.policySource
          ? `Policy: ${result.policySource.scope} · ${result.policySource.trackName} · v${result.policySource.policyVersion}`
          : 'No resolved policy',
        result.preferredTarget
          ? `Preferred: ${result.preferredTarget.version}`
          : 'No resolved preferred target',
      ].join('\n')}
    >
      <StatusBadge tone={tone}>{firmwareComplianceLabel(result)}</StatusBadge>
    </span>
  )
}
