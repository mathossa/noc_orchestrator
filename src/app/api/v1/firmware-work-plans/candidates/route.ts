import { NextResponse } from 'next/server'
import {
  FirmwareWorkPlanCandidateError,
  listFirmwareWorkPlanCandidates,
} from '@/lib/firmware-work-plan-candidates'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({
      data: await listFirmwareWorkPlanCandidates(body),
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must contain valid JSON.',
          },
        },
        { status: 400 },
      )
    }
    if (error instanceof FirmwareWorkPlanCandidateError) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_SCOPE',
            message: error.message,
          },
        },
        { status: error.status },
      )
    }
    console.error('Firmware work plan candidate resolution failed.', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Planning candidates could not be resolved.',
        },
      },
      { status: 500 },
    )
  }
}
