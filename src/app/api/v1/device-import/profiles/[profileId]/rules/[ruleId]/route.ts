import { NextResponse } from 'next/server'
import {
  deleteImportProfileRule,
  DeviceImportProfileRuleError,
  updateImportProfileRule,
} from '@/lib/device-import-profile-rule-store'
import { updateImportProfileRulePriority } from '@/lib/device-import-profile-rule-priority'

type RouteContext = { params: Promise<{ profileId: string; ruleId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const { profileId, ruleId } = await context.params
  try {
    const body = await request.json() as Record<string, unknown>
    const hasActive = typeof body.isActive === 'boolean'
    const hasPriority = body.priority !== undefined
    if (!hasActive && !hasPriority) {
      throw new DeviceImportProfileRuleError('Choose a rule property to update.')
    }
    const result: { id: string; isActive?: boolean; priority?: number } = { id: ruleId }
    if (hasActive) {
      const active = await updateImportProfileRule(profileId, ruleId, { isActive: body.isActive })
      result.isActive = active.isActive
    }
    if (hasPriority) {
      const priority = await updateImportProfileRulePriority(profileId, ruleId, body.priority)
      result.priority = priority.priority
    }
    return NextResponse.json({ data: result })
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
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
