import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  firmwareWorkPlanApiError,
  parseFirmwareWorkPlanBulkTransition,
} from '@/lib/firmware-work-plan-api'
import { bulkTransitionFirmwareWorkPlans } from '@/lib/firmware-work-plan-store'

export async function POST(request: Request) {
  try {
    const input = parseFirmwareWorkPlanBulkTransition(await request.json())
    const session = await auth.api.getSession({ headers: request.headers })
    const data = await bulkTransitionFirmwareWorkPlans({
      ...input,
      actorUserId: session?.user.id ?? null,
    })
    return NextResponse.json({ data })
  } catch (error) {
    return firmwareWorkPlanApiError(error)
  }
}
