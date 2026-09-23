import type { FirmwarePolicySource } from '@/lib/firmware-policies'

/** Presentation of the canonical resolver's source; never infers policy from versions. */
export function firmwarePolicyLabel(source: FirmwarePolicySource | null) {
  if (!source) return 'No resolved policy'
  const labels: Record<FirmwarePolicySource['scope'], string> = {
    CATALOG: 'Catalog default',
    MODEL: 'Model policy',
    FAMILY: 'Family policy',
    CUSTOMER: 'Customer override',
    SITE: 'Site override',
    DEVICE: 'Device override',
  }
  return labels[source.scope]
}
