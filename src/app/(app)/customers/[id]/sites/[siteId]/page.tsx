import { SiteDetail } from '@/components/sites/site-detail'

type PageProps = { params: Promise<{ id: string; siteId: string }> }

export default async function CustomerSiteDetailPage({ params }: PageProps) {
  const { id, siteId } = await params
  return <SiteDetail customerId={id} siteId={siteId} />
}
