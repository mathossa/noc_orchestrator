import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import {
  configureInventorySyncSchedule,
  getInventorySyncScheduleStatus,
} from '@/lib/inventory-sync-scheduling'

type RouteContext = { params: Promise<{ sourceId: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    return NextResponse.json({
      data: await getInventorySyncScheduleStatus(sourceId),
    })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: { code: 'ACCESS_DENIED', message: error.message } },
        { status: error.status },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to read inventory sync schedule.'
    return NextResponse.json(
      { error: { code: 'INVENTORY_SYNC_SCHEDULE_READ_FAILED', message } },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean.')
    }
    if (body.expression !== undefined && typeof body.expression !== 'string') {
      throw new Error('expression must be a string.')
    }
    if (body.timezone !== undefined && typeof body.timezone !== 'string') {
      throw new Error('timezone must be a string.')
    }
    return NextResponse.json({
      data: await configureInventorySyncSchedule({
        sourceId,
        enabled: body.enabled,
        expression:
          typeof body.expression === 'string' ? body.expression : undefined,
        timezone:
          typeof body.timezone === 'string' ? body.timezone : undefined,
      }),
    })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: { code: 'ACCESS_DENIED', message: error.message } },
        { status: error.status },
      )
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to update inventory sync schedule.'
    return NextResponse.json(
      { error: { code: 'INVENTORY_SYNC_SCHEDULE_UPDATE_FAILED', message } },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}
