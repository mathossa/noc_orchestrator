import { DeviceModelManager } from '@/components/device-models/device-model-manager'

type ModelsPageProps = {
  searchParams: Promise<{ edit?: string }>
}

export default async function ModelsPage({ searchParams }: ModelsPageProps) {
  const params = await searchParams
  return <DeviceModelManager initialEditId={params.edit ?? ''} />
}
