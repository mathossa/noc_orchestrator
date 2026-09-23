import { NextResponse } from 'next/server'
import { firmwareReviewApiError } from '@/lib/firmware-review-api'
import { getFirmwareReviewCycle } from '@/lib/firmware-review-store'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const cycle = await getFirmwareReviewCycle(id)
    if (!cycle)
      return NextResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Review cycle was not found.',
          },
        },
        { status: 404 },
      )
    return NextResponse.json({ data: cycle })
  } catch (error) {
    return firmwareReviewApiError(error)
  }
}
