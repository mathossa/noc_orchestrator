import { DeviceManager } from '@/components/devices/device-manager'

type DevicesPageProps = {
  searchParams: Promise<{ customer?: string; site?: string }>
}

export default async function DevicesPage({ searchParams }: DevicesPageProps) {
  const params = await searchParams
  return <DeviceManager initialCustomerId={params.customer ?? ''} initialSiteId={params.site ?? ''} />
}
