import { FirmwareReviewCreate } from '@/components/firmware/reports/firmware-review-create'
import { listCustomers } from '@/lib/customer-store'

export const dynamic = 'force-dynamic'

export default async function NewFirmwareReviewPage() {
  const customers = (await listCustomers()).filter(
    (customer) => customer.isActive,
  )
  return <FirmwareReviewCreate customers={customers} />
}
