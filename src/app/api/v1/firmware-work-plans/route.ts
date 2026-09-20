import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  firmwareWorkPlanApiError,
  FirmwareWorkPlanApiValidationError,
  parseFirmwareWorkPlanQuery,
} from '@/lib/firmware-work-plan-api'
import { listFirmwareWorkPlans } from '@/lib/firmware-work-plan-query-store'
import {
  createFirmwareWorkPlan,
  previewFirmwareWorkPlan,
} from '@/lib/firmware-work-plan-store'

function requestBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FirmwareWorkPlanApiValidationError(
      'Request body must be an object.',
    )
  return value as Record<string, unknown>
}

export async function GET(request: Request) {
  try {
    const query = parseFirmwareWorkPlanQuery(
      new URL(request.url).searchParams,
    )
    return NextResponse.json(await listFirmwareWorkPlans(query))
  } catch (error) {
    return firmwareWorkPlanApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = requestBody(await request.json())

    if (body.action === 'preview')
      return NextResponse.json({
        data: await previewFirmwareWorkPlan(body.input),
      })

    if (body.action === 'create') {
      if (typeof body.token !== 'string' || !body.token.trim())
        throw new FirmwareWorkPlanApiValidationError(
          'A preview confirmation token is required.',
          { token: 'Preview the selected devices before creating the plan.' },
        )
      const session = await auth.api.getSession({ headers: request.headers })
      return NextResponse.json(
        {
          data: await createFirmwareWorkPlan(
            body.input,
            body.token,
            session?.user.id ?? null,
          ),
        },
        { status: 201 },
      )
    }

    throw new FirmwareWorkPlanApiValidationError(
      'Choose preview or create.',
      { action: 'Choose a supported planning action.' },
    )
  } catch (error) {
    return firmwareWorkPlanApiError(error)
  }
}
