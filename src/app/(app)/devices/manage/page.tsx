import { notFound } from 'next/navigation'
import { DeviceNotFoundError, getDevice } from '@/lib/device-store'
import { Suspense } from 'react'
import { DeviceManager } from '@/components/devices/device-manager'

export const dynamic = 'force-dynamic'

type DevicesManagePageProps = {
  searchParams: Promise<{ customer?: string; site?: string; model?: string; edit?: string }>
}

export default async function DevicesManagePage({
  searchParams,
}: DevicesManagePageProps) {
  const params = await searchParams
  const editRecord = params.edit ? await getDevice(params.edit).catch((error: unknown) => {
    if (error instanceof DeviceNotFoundError) notFound()
    throw error
  }) : undefined
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          Loading device management…
        </div>
      }
    >
      <DeviceManager
        key={editRecord?.id ?? 'records'}
        initialEditRecord={editRecord}
        initialCustomerId={params.customer ?? ''}
        initialSiteId={params.site ?? ''}
        initialModelId={params.model ?? ''}
      />
    </Suspense>
  )
}
