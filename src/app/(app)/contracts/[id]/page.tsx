import { ContractDetail } from '@/components/contracts/contract-detail'

type ContractPageProps = { params: Promise<{ id: string }> }

export default async function ContractPage({ params }: ContractPageProps) {
  const { id } = await params
  return <ContractDetail contractId={id} />
}
