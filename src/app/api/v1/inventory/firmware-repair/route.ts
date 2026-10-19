import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import {
  CanonicalFirmwareRepairError,
  applyCanonicalFirmwareRepairs,
  previewCanonicalFirmwareRepairs,
  rollbackCanonicalFirmwareRepair,
} from '@/lib/firmware-canonical-repair-store'

export const dynamic = 'force-dynamic'

function failure(error: unknown) {
  if (error instanceof AdminAccessError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }
  if (error instanceof CanonicalFirmwareRepairError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: { message: 'Request body must contain valid JSON.' } }, { status: 400 })
  }
  console.error('Canonical firmware repair failed', error)
  return NextResponse.json({ error: { message: 'Canonical firmware repair failed. Check server logs.' } }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    await requireAdminRequest(request)
    return NextResponse.json({ data: await previewCanonicalFirmwareRepairs() }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminRequest(request)
    const body = await request.json()
    if (body?.action === 'rollback') {
      return NextResponse.json({
        data: await rollbackCanonicalFirmwareRepair(body.auditEventId, session.user.id),
      })
    }
    if (body?.action !== 'apply') {
      return NextResponse.json({ error: { message: 'Expected action apply or rollback.' } }, { status: 400 })
    }
    return NextResponse.json({
      data: await applyCanonicalFirmwareRepairs(body, session.user.id),
    })
  } catch (error) {
    return failure(error)
  }
}
