import { NextResponse } from 'next/server'
import {
  deleteImportProfileRule,
  DeviceImportProfileRuleError,
  updateImportProfileRule,
} from '@/lib/device-import-profile-rule-store'

type RouteContext = { params: Promise<{ profileId: string; ruleId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const { profileId, ruleId } = await context.params
  try {
    return NextResponse.json({
      data: await updateImportProfileRule(
        profileId,
        ruleId,
        await request.json(),
      ),
    })
  } catch (error) {
    if (error instanceof DeviceImportProfileRuleError)
      return NextResponse.json(
        { error: { code: 'INVALID_RULE', message: error.message } },
        { status: 400 },
      )
    console.error('Failed to update import profile rule', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The import rule could not be updated.',
        },
      },
      { status: 500 },
    )
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { profileId, ruleId } = await context.params
  try {
    return NextResponse.json({
      data: await deleteImportProfileRule(profileId, ruleId),
    })
  } catch (error) {
    if (error instanceof DeviceImportProfileRuleError)
      return NextResponse.json(
        { error: { code: 'INVALID_RULE', message: error.message } },
        { status: 400 },
      )
    console.error('Failed to delete import profile rule', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The import rule could not be deleted.',
        },
      },
      { status: 500 },
    )
  }
}
