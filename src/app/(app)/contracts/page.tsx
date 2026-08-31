import { ReferenceDataManager } from '@/components/reference-data/reference-data-manager'

export default function ContractTypesPage() {
  return (
    <ReferenceDataManager
      kind="contract-types"
      title="Contract types"
      description="Configure service/contract categories and whether firmware management applies to each type."
    />
  )
}
