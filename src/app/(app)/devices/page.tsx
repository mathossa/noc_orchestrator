import Link from 'next/link'
import { Suspense } from 'react'
import { DeviceManager } from '@/components/devices/device-manager'

type DevicesPageProps = {
  searchParams: Promise<{ customer?: string; site?: string; model?: string }>
}

export default async function DevicesPage({ searchParams }: DevicesPageProps) {
  const params = await searchParams
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Link
          href="/devices/import"
          className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:border-[var(--accent-muted)] hover:bg-[var(--surface-muted)]"
        >
          Import devices from XLSX
        </Link>
      </div>
      <Suspense fallback={<div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">Loading device query…</div>}>
        <DeviceManager
          initialCustomerId={params.customer ?? ''}
          initialSiteId={params.site ?? ''}
          initialModelId={params.model ?? ''}
        />
      </Suspense>
    </>
  )
}
