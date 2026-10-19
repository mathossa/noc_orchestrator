import { redirect } from 'next/navigation'

// Backwards-compatible navigation from the first #152 draft. This is not a
// separate vendor-specific repair screen.
export default function LegacyFirmwareRepairPage() {
  redirect('/devices/manage/repairs')
}
