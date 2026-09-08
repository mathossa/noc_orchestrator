import { NextResponse } from 'next/server'
import { getReleaseModelCompatibilityView } from '@/lib/firmware-compatibility-view'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const data = await getReleaseModelCompatibilityView(id)
    if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Firmware release was not found.' } }, { status: 404 })
    return NextResponse.json({ data })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Firmware compatibility could not be loaded.' } }, { status: 500 })
  }
}
