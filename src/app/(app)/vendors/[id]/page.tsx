import { VendorDetail } from '@/components/vendors/vendor-detail'

type VendorPageProps = { params: Promise<{ id: string }> }

export default async function VendorPage({ params }: VendorPageProps) {
  const { id } = await params
  return <VendorDetail vendorId={id} />
}
