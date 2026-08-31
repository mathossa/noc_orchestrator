'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/page-state'

export default function ApplicationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="This view could not be loaded"
      description="The application shell is still available. Retry the failed view, or use the navigation to move elsewhere."
      action={<Button onClick={reset}>Try again</Button>}
    />
  )
}
