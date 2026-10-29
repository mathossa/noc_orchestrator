import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { referenceApiError } from '@/lib/reference-data-api'
import {
  createReferenceRecord,
  listReferenceData,
  parseReferenceKind,
} from '@/lib/reference-data-store'

type RouteContext = { params: Promise<{ kind: string }> }

async function GETHandler(_request: Request, context: RouteContext) {
  const { kind: rawKind } = await context.params
  const kind = parseReferenceKind(rawKind)

  if (!kind) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown reference-data type.' } },
      { status: 404 },
    )
  }

  try {
    return NextResponse.json({ data: await listReferenceData(kind) })
  } catch (error) {
    return referenceApiError(error)
  }
}

async function POSTHandler(request: Request, context: RouteContext) {
  const { kind: rawKind } = await context.params
  const kind = parseReferenceKind(rawKind)

  if (!kind) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown reference-data type.' } },
      { status: 404 },
    )
  }

  try {
    const body = await request.json()
    const record = await createReferenceRecord(kind, body)
    return NextResponse.json({ data: record }, { status: 201 })
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

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
