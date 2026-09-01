import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { firmwarePolicyApiError } from '@/lib/firmware-policy-api'
import {
  bulkClearModelDesiredFirmwarePolicies,
  bulkSetModelDesiredFirmwarePolicies,
} from '@/lib/firmware-policy-store'

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { modelIds?: unknown; firmwareReleaseId?: unknown }
    const session = await auth.api.getSession({ headers: request.headers })
    const data = await bulkSetModelDesiredFirmwarePolicies(
      body.modelIds,
      body.firmwareReleaseId,
      session?.user.id ?? null,
    )
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return firmwarePolicyApiError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { modelIds?: unknown }
    const session = await auth.api.getSession({ headers: request.headers })
    const data = await bulkClearModelDesiredFirmwarePolicies(body.modelIds, session?.user.id ?? null)
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return firmwarePolicyApiError(error)
  }
}
