import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  firmwareReviewApiError,
  parseFirmwareReviewQuery,
} from '@/lib/firmware-review-api'
import {
  createFirmwareReviewCycle,
  listFirmwareReviewCycles,
} from '@/lib/firmware-review-store'

export async function GET(request: Request) {
  try {
    const query = parseFirmwareReviewQuery(new URL(request.url).searchParams)
    return NextResponse.json({
      data: await listFirmwareReviewCycles(query),
    })
  } catch (error) {
    return firmwareReviewApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json(
      {
        data: await createFirmwareReviewCycle(
          body,
          session?.user.id ?? null,
        ),
      },
      { status: 201 },
    )
  } catch (error) {
    return firmwareReviewApiError(error)
  }
}
