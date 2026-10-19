import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { customerApiError } from '@/lib/customer-api'
import { deleteCustomer, getCustomer, updateCustomer } from '@/lib/customer-store'

type RouteContext = { params: Promise<{ id: string }> }

async function GETHandler(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    return NextResponse.json({ data: await getCustomer(id) })
  } catch (error) {
    return customerApiError(error)
  }
}

async function PATCHHandler(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await updateCustomer(id, body) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return customerApiError(error)
  }
}

async function DELETEHandler(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    await deleteCustomer(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return customerApiError(error)
  }
}

export const GET = withAdmin(GETHandler)
export const PATCH = withAdmin(PATCHHandler)
export const DELETE = withAdmin(DELETEHandler)
