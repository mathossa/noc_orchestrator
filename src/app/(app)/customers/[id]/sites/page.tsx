import { SiteManager } from '@/components/sites/site-manager'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ organizationUnit?: string }>
}

export default async function CustomerSitesPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  return <SiteManager customerId={id} initialOrganizationUnit={query.organizationUnit ?? ''} />
}
