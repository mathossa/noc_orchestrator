import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import {
  CanonicalFirmwareRepairError,
  applyCanonicalFirmwareRepairs,
  previewInventoryFirmwareRepairs,
  rollbackCanonicalFirmwareRepair,
} from '@/lib/inventory-firmware-repair-store'

export const dynamic = 'force-dynamic'

function failure(error: unknown) {
  if (error instanceof AdminAccessError || error instanceof CanonicalFirmwareRepairError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: { message: 'Invalid JSON.' } }, { status: 400 })
  }
  console.error('Inventory firmware link correction failed', error)
  return NextResponse.json({ error: { message: 'Inventory correction failed. Check server logs.' } }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    await requireAdminRequest(request)
    const params = new URL(request.url).searchParams
    const requested = Number(params.get('page') ?? '1')
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 10000) {
      return NextResponse.json({ error: { message: 'Invalid page.' } }, { status: 400 })
    }
    return NextResponse.json({
      data: await previewInventoryFirmwareRepairs({
        page: requested,
        q: params.get('q') ?? '',
        vendorId: params.get('vendorId') ?? '',
        linkedPlatform: params.get('linkedPlatform') ?? '',
      }),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
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
      return NextResponse.json({ error: { message: 'Invalid inventory correction operation.' } }, { status: 400 })
    }
    return NextResponse.json({ data: await applyCanonicalFirmwareRepairs(body, session.user.id) })
  } catch (error) {
    return failure(error)
  }
}
