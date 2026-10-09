import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { firmwareReviewApiError } from '@/lib/firmware-review-api'
import { generateFirmwareReviewReport } from '@/lib/firmware-review-store'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json(
      {
        data: await generateFirmwareReviewReport(
          id,
          session?.user.id ?? null,
        ),
      },
      { status: 201 },
    )
  } catch (error) {
    return firmwareReviewApiError(error)
  }
}
