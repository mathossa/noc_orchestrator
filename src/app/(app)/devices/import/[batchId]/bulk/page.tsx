import Link from 'next/link'
import { DeviceImportBulkResolve } from '@/components/devices/device-import-bulk-resolve'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBulkResolvePage({ params }: PageProps) {
  const { batchId } = await params
  return <>
    <div className="mb-3 flex justify-end">
      <Link
        href={`/devices/import/${batchId}/models`}
        className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent-light)] hover:brightness-110"
      >
        Model + family assistant
      </Link>
    </div>
    <DeviceImportBulkResolve batchId={batchId} />
  </>
}
