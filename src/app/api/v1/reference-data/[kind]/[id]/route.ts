import { NextResponse } from 'next/server'
import { referenceApiError } from '@/lib/reference-data-api'
import {
  deleteReferenceRecord,
  parseReferenceKind,
  updateReferenceRecord,
} from '@/lib/reference-data-store'

type RouteContext = { params: Promise<{ kind: string; id: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const { kind: rawKind, id } = await context.params
  const kind = parseReferenceKind(rawKind)

  if (!kind) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown reference-data type.' } },
      { status: 404 },
    )
  }

  try {
    const body = await request.json()
    return NextResponse.json({ data: await updateReferenceRecord(kind, id, body) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return referenceApiError(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { kind: rawKind, id } = await context.params
  const kind = parseReferenceKind(rawKind)

  if (!kind) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown reference-data type.' } },
      { status: 404 },
    )
  }

  try {
    await deleteReferenceRecord(kind, id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return referenceApiError(error)
  }
}
