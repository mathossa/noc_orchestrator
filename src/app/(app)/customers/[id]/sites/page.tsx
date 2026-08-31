import { SiteManager } from '@/components/sites/site-manager'

type PageProps = { params: Promise<{ id: string }> }

export default async function CustomerSitesPage({ params }: PageProps) {
  const { id } = await params
  return <SiteManager customerId={id} />
}
