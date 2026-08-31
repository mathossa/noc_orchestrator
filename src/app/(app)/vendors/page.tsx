import { ReferenceDataManager } from '@/components/reference-data/reference-data-manager'

export default function VendorsPage() {
  return (
    <ReferenceDataManager
      kind="vendors"
      title="Vendors"
      description="Configure network vendors used by device models, firmware releases, policies, and product-wide filtering."
    />
  )
}
