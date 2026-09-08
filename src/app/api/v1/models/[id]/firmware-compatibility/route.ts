import { NextResponse } from 'next/server'
import {
  clearFirmwareCompatibilityOverride,
  FirmwareCompatibilityNotFoundError,
  FirmwareCompatibilityReferenceError,
  FirmwareCompatibilityValidationError,
  setFirmwareCompatibilityOverride,
} from '@/lib/firmware-compatibility-store'
import { getModelFirmwareCompatibilityView } from '@/lib/firmware-compatibility-view'

type RouteContext = { params: Promise<{ id: string }> }

function compatibilityApiError(error: unknown) {
  if (error instanceof FirmwareCompatibilityValidationError) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 })
  }
  if (error instanceof FirmwareCompatibilityReferenceError || error instanceof FirmwareCompatibilityNotFoundError) {
    return NextResponse.json({ error: { code: 'REFERENCE_ERROR', message: error.message } }, { status: 404 })
  }
  console.error(error)
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Firmware compatibility could not be updated.' } }, { status: 500 })
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    return NextResponse.json({ data: await getModelFirmwareCompatibilityView(id) })
  } catch (error) {
    return compatibilityApiError(error)
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = (await request.json()) as { firmwareReleaseId?: unknown; decision?: unknown; reason?: unknown }
    await setFirmwareCompatibilityOverride(
      {
        deviceModelId: id,
        firmwareReleaseId: body.firmwareReleaseId,
        decision: body.decision,
        reason: body.reason,
      },
      null,
    )
    return NextResponse.json({ data: await getModelFirmwareCompatibilityView(id) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return compatibilityApiError(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params
  try {
    const body = (await request.json()) as { firmwareReleaseId?: unknown }
    await clearFirmwareCompatibilityOverride(id, body.firmwareReleaseId, null)
    return NextResponse.json({ data: await getModelFirmwareCompatibilityView(id) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    return compatibilityApiError(error)
  }
}
