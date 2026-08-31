import { EmptyState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'

export function SectionPlaceholder({
  title,
  description,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  description: string
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState title={emptyTitle} description={emptyDescription} />
    </>
  )
}
