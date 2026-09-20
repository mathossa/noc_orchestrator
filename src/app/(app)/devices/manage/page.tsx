import { Suspense } from 'react'
import { DeviceManager } from '@/components/devices/device-manager'

type DevicesManagePageProps = {
  searchParams: Promise<{ customer?: string; site?: string; model?: string }>
}

export default async function DevicesManagePage({
  searchParams,
}: DevicesManagePageProps) {
  const params = await searchParams
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          Loading device management…
        </div>
      }
    >
      <DeviceManager
        initialCustomerId={params.customer ?? ''}
        initialSiteId={params.site ?? ''}
        initialModelId={params.model ?? ''}
      />
    </Suspense>
  )
}
