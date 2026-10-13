import { ReferenceDataManager } from '@/components/reference-data/reference-data-manager'
import { ReferenceDrilldownDirectory } from '@/components/reference-data/reference-drilldown-directory'

export default function ContractTypesPage() {
  return (
    <>
      <ReferenceDataManager
        kind="contract-types"
        title="Contract types"
        description="Configure service/contract categories, firmware-management applicability, and whether each contract appears as its own inventory-report tab."
      />
      <ReferenceDrilldownDirectory
        kind="contract-types"
        basePath="/contracts"
        title="Firmware lifecycle drill-down"
        description="Open a contract type to inspect effective applicability, site overrides, technical desired-state counts, workflow decisions, provenance, and freshness."
      />
    </>
  )
}
