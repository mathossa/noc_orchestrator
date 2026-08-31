import { SectionPlaceholder } from '@/components/ui/section-placeholder'

export default function FirmwarePage() {
  return (
    <SectionPlaceholder
      title="Firmware"
      description="Firmware releases, metadata, approval status, and desired-state targets."
      emptyTitle="Firmware catalog is not connected yet"
      emptyDescription="The catalog route is reserved for the firmware release workflow in the MVP."
    />
  )
}
