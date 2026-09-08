import {
  firmwareComplianceLabel,
  type FirmwareComplianceResult,
} from '@/lib/firmware-compliance'

export function FirmwareComplianceStatus({
  result,
}: {
  result: FirmwareComplianceResult
}) {
  const urgency =
    result.compliance === 'BLOCKED_RELEASE'
      ? 'critical'
      : result.recommendation === 'UPDATE_REQUIRED' ||
          result.compliance === 'INCOMPATIBLE' ||
          (result.compliance === 'OUTSIDE_RANGE' &&
            result.recommendation !== 'PLATFORM_MIGRATION') ||
          result.targetCompatibility?.status === 'INCOMPATIBLE'
        ? 'required'
        : result.recommendation === 'UPDATE_RECOMMENDED' ||
            result.recommendation === 'PLATFORM_MIGRATION'
          ? 'recommended'
          : result.compliance === 'PREFERRED'
            ? 'preferred'
            : result.recommendation === 'NO_ACTION'
              ? 'accepted'
              : 'unknown'
  const styles = {
    critical: 'border-red-400/40 bg-red-500/10 text-red-200',
    required: 'border-orange-400/40 bg-orange-500/10 text-orange-200',
    recommended: 'border-yellow-400/40 bg-yellow-500/10 text-yellow-200',
    unknown: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
    preferred: 'border-green-400/40 bg-green-500/10 text-green-200',
    accepted:
      'border-[var(--border-strong)] bg-[var(--surface-muted)] text-[var(--muted-strong)]',
  }
  const fullLabel = firmwareComplianceLabel(result)
  const [label, detail] = fullLabel.split(' — ')
  return (
    <span
      className={`inline-flex max-w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left align-middle ${styles[urgency]}`}
      aria-label={fullLabel}
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
      <span className="min-w-0 whitespace-normal">
        <span className="block text-xs font-semibold leading-4">{label}</span>
        {detail ? (
          <span className="block text-[11px] font-normal leading-4">
            {detail.charAt(0).toUpperCase() + detail.slice(1)}
          </span>
        ) : null}
      </span>
    </span>
  )
}
