import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { deviceApiError } from '@/lib/device-api'
import { deleteDevice, getDevice, updateDevice } from '@/lib/device-store'

type RouteContext = { params: Promise<{ id: string }> }

async function GETHandler(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    return NextResponse.json({ data: await getDevice(id) })
  } catch (error) {
    return deviceApiError(error)
  }
}

async function PATCHHandler(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({ data: await updateDevice(id, body, session?.user.id ?? null) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return deviceApiError(error)
  }
}

async function DELETEHandler(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    await deleteDevice(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return deviceApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const PATCH = withAdmin(PATCHHandler)
export const DELETE = withAdmin(DELETEHandler)
