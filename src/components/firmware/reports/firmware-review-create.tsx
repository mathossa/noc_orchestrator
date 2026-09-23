'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import {
  FormActions,
  FormField,
  FormSection,
  SelectInput,
  TextInput,
} from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'

type CustomerOption = {
  id: string
  name: string
  code: string | null
}

type ApiError = { error?: { message?: string } }

export function FirmwareReviewCreate({
  customers,
}: {
  customers: CustomerOption[]
}) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [nextReviewAt, setNextReviewAt] = useState('')
  const [reviewerName, setReviewerName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function createCycle() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/v1/firmware-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
          nextReviewAt: nextReviewAt || undefined,
          reviewerName: reviewerName || undefined,
        }),
      })
      const payload = (await response.json()) as {
        data?: { id: string }
      } & ApiError
      if (!response.ok || !payload.data)
        throw new Error(
          payload.error?.message ?? 'Review cycle could not be created.',
        )
      router.push('/reports/' + encodeURIComponent(payload.data.id))
      router.refresh()
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Review cycle could not be created.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Create firmware review cycle"
        description="Start a customer review cycle. Leave dates empty to use the normal approximately quarterly window and next-review cadence."
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
          { label: 'New review cycle' },
        ]}
      />

      <div className="max-w-3xl">
        <FormSection
          title="Review cycle"
          description="Creating the cycle does not yet snapshot live firmware state. Generate an immutable report version from the cycle detail when the review is ready."
        >
          <FormField label="Customer" htmlFor="review-customer">
            <SelectInput
              id="review-customer"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              disabled={!customers.length}
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.code ? ' · ' + customer.code : ''}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <FormField
            label="Reviewer name"
            htmlFor="reviewer-name"
            description="Optional display name retained on the cycle."
          >
            <TextInput
              id="reviewer-name"
              value={reviewerName}
              onChange={(event) => setReviewerName(event.target.value)}
              maxLength={200}
            />
          </FormField>

          <FormField
            label="Period start"
            htmlFor="review-period-start"
            description="Optional. Blank uses three months before creation."
          >
            <TextInput
              id="review-period-start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </FormField>

          <FormField
            label="Period end"
            htmlFor="review-period-end"
            description="Optional. Blank uses the creation date."
          >
            <TextInput
              id="review-period-end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </FormField>

          <FormField
            label="Next review"
            htmlFor="review-next"
            description="Optional. Blank uses approximately three months after creation."
          >
            <TextInput
              id="review-next"
              type="date"
              value={nextReviewAt}
              onChange={(event) => setNextReviewAt(event.target.value)}
            />
          </FormField>
        </FormSection>

        {error ? (
          <p className="mt-4 text-sm font-medium text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}

        <FormActions>
          <ButtonLink href="/reports" variant="ghost">
            Cancel
          </ButtonLink>
          <Button
            variant="primary"
            disabled={busy || !customerId}
            onClick={() => void createCycle()}
          >
            {busy ? 'Creating…' : 'Create review cycle'}
          </Button>
        </FormActions>
      </div>
    </>
  )
}
