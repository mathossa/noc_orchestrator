import { CustomerDetail } from '@/components/customers/customer-detail'

type PageProps = { params: Promise<{ id: string }> }

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params
  return <CustomerDetail customerId={id} />
}
