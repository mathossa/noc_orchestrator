import { SectionPlaceholder } from '@/components/ui/section-placeholder'

export default function CustomersPage() {
  return (
    <SectionPlaceholder
      title="Customers"
      description="Customer context for firmware policy, inventory, contract type, and lifecycle decisions."
      emptyTitle="Customer management is not connected yet"
      emptyDescription="The reusable application shell is ready; customer CRUD is implemented in its dedicated MVP issue."
    />
  )
}
