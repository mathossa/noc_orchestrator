import { ReferenceDataManager } from '@/components/reference-data/reference-data-manager'
import { ReferenceDrilldownDirectory } from '@/components/reference-data/reference-drilldown-directory'

export default function VendorsPage() {
  return (
    <>
      <ReferenceDataManager
        kind="vendors"
        title="Vendors"
        description="Configure network vendors used by device models, firmware releases, policies, and product-wide filtering."
      />
      <ReferenceDrilldownDirectory
        kind="vendors"
        basePath="/vendors"
        title="Firmware lifecycle drill-down"
        description="Open a vendor to inspect models, devices, exact desired-state compliance, workflow decisions, release usage, provenance, and freshness."
      />
    </>
  )
}
