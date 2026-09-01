import Link from 'next/link'
import { DeviceImportBatchWorkspace } from '@/components/devices/device-import-batch'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <>
    <div className="mb-3 flex justify-end">
      <Link
        href={`/devices/import/${batchId}/bulk`}
        className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent-light)] hover:brightness-110"
      >
        Bulk resolve mappings
      </Link>
    </div>
    <DeviceImportBatchWorkspace batchId={batchId} />
  </>
}
