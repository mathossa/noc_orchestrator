import { ReferenceDataManager } from '@/components/reference-data/reference-data-manager'

export default function DeviceTypesPage() {
  return (
    <ReferenceDataManager
      kind="device-types"
      title="Device types"
      description="Configure reusable device categories without limiting the platform to a fixed set of network roles."
    />
  )
}
