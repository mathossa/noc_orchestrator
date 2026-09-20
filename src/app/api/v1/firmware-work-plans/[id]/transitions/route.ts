import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  firmwareWorkPlanApiError,
  parseFirmwareWorkPlanTransition,
} from '@/lib/firmware-work-plan-api'
import { transitionFirmwareWorkPlan } from '@/lib/firmware-work-plan-store'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const input = parseFirmwareWorkPlanTransition(await request.json())
    const session = await auth.api.getSession({ headers: request.headers })
    const plan = await transitionFirmwareWorkPlan(id, {
      ...input,
      actorUserId: session?.user.id ?? null,
    })
    return NextResponse.json({ data: plan })
  } catch (error) {
    return firmwareWorkPlanApiError(error)
  }
}
