import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { annotateDevice } from '@/lib/device-annotations'
import { deviceApiError } from '@/lib/device-api'
import { getDevice } from '@/lib/device-store'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const session = await auth.api.getSession({ headers: request.headers })
    await annotateDevice(id, body, session?.user.id ?? null)
    return NextResponse.json({ data: await getDevice(id) })
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must contain valid JSON.',
          },
        },
        { status: 400 },
      )
    return deviceApiError(error)
  }
}
