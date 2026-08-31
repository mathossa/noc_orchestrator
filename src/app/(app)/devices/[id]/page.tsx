import { DeviceDetail } from '@/components/devices/device-detail'

type DevicePageProps = { params: Promise<{ id: string }> }

export default async function DevicePage({ params }: DevicePageProps) {
  const { id } = await params
  return <DeviceDetail deviceId={id} />
}
