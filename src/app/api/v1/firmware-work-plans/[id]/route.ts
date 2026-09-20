import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  firmwareWorkPlanApiError,
  parseFirmwareWorkPlanProposalAmendment,
} from '@/lib/firmware-work-plan-api'
import { getFirmwareWorkPlan } from '@/lib/firmware-work-plan-query-store'
import {
  amendFirmwareWorkPlanProposal,
  FirmwareWorkPlanError,
} from '@/lib/firmware-work-plan-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const plan = await getFirmwareWorkPlan(id)
    if (!plan)
      throw new FirmwareWorkPlanError(
        'Firmware work plan was not found.',
        404,
      )
    return NextResponse.json({ data: plan })
  } catch (error) {
    return firmwareWorkPlanApiError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const input = parseFirmwareWorkPlanProposalAmendment(await request.json())
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({
      data: await amendFirmwareWorkPlanProposal(id, {
        ...input,
        actorUserId: session?.user.id ?? null,
      }),
    })
  } catch (error) {
    return firmwareWorkPlanApiError(error)
  }
}
