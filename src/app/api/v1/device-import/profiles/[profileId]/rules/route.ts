import { NextResponse } from 'next/server'
import {
  createImportProfilePredictionRule,
  DeviceImportProfileRuleError,
  listImportProfileRuleWorkspace,
} from '@/lib/device-import-profile-rule-store'

type RouteContext = { params: Promise<{ profileId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { profileId } = await context.params
  try {
    return NextResponse.json({
      data: await listImportProfileRuleWorkspace(profileId),
    })
  } catch (error) {
    if (error instanceof DeviceImportProfileRuleError)
      return NextResponse.json(
        { error: { code: 'INVALID_RULE', message: error.message } },
        { status: 400 },
      )
    console.error('Failed to list import profile rules', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Import rules could not be loaded.',
        },
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { profileId } = await context.params
  try {
    return NextResponse.json({
      data: await createImportProfilePredictionRule(
        profileId,
        await request.json(),
      ),
    })
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must contain valid JSON.',
          },
        },
        { status: 400 },
      )
    if (error instanceof DeviceImportProfileRuleError)
      return NextResponse.json(
        { error: { code: 'INVALID_RULE', message: error.message } },
        { status: 400 },
      )
    console.error('Failed to create import profile rule', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The import rule could not be saved.',
        },
      },
      { status: 500 },
    )
  }
}
