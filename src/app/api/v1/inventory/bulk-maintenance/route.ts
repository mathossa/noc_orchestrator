import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import {
  InventoryBulkMaintenanceError,
  listInventoryBulkReferences,
  previewInventoryBulkMaintenance,
  applyInventoryBulkMaintenance,
} from '@/lib/inventory-bulk-maintenance-store'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof AdminAccessError || error instanceof InventoryBulkMaintenanceError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: { message: 'Malformed JSON.' } }, { status: 400 })
  }
  console.error('Inventory bulk maintenance failed', error)
  return NextResponse.json({ error: { message: 'Bulk maintenance could not be completed.' } }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    await requireAdminRequest(request)
    return NextResponse.json({ data: await listInventoryBulkReferences() }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminRequest(request)
    const input = await request.json()
    if (input?.action === 'preview') {
      return NextResponse.json({ data: await previewInventoryBulkMaintenance(input) })
    }
    if (input?.action === 'apply') {
      return NextResponse.json({ data: await applyInventoryBulkMaintenance(input, session.user.id) })
    }
    return NextResponse.json({ error: { message: 'Choose preview or apply.' } }, { status: 400 })
  } catch (error) {
    return fail(error)
  }
}
