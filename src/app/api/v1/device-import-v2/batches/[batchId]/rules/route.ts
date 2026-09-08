import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { IMPORTER_V2_FIELDS, type ImporterV2Field } from '@/lib/importer-v2-evaluator'
import {
  applyImporterV2GuidedRule,
  previewImporterV2GuidedRule,
  type ImporterV2RuleWizardInput,
} from '@/lib/importer-v2-rule-wizard-store'

const OPERATORS = new Set([
  'NORMALIZED_EXACT',
  'PREFIX',
  'CONTAINS',
  'PATTERN',
  'VERSION_MATCH',
])
const SCOPES = new Set(['PROFILE', 'CUSTOMER', 'VENDOR', 'MODEL'])

type RouteContext = { params: Promise<{ batchId: string }> }

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseWizard(value: unknown): ImporterV2RuleWizardInput {
  const input = object(value)
  if (!input) throw new Error('wizard input is required.')
  if (
    typeof input.rowNumber !== 'number' ||
    !Number.isInteger(input.rowNumber) ||
    input.rowNumber < 1
  ) {
    throw new Error('wizard.rowNumber must be a positive integer.')
  }
  if (
    typeof input.field !== 'string' ||
    !IMPORTER_V2_FIELDS.includes(input.field as ImporterV2Field)
  ) {
    throw new Error('wizard.field must be a supported importer field.')
  }
  if (typeof input.operator !== 'string' || !OPERATORS.has(input.operator)) {
    throw new Error('wizard.operator must use a supported guided match type.')
  }
  if (typeof input.matchValue !== 'string' || !input.matchValue.trim()) {
    throw new Error('wizard.matchValue is required.')
  }
  const target = object(input.target)
  if (!target || typeof target.label !== 'string' || !target.label.trim()) {
    throw new Error('wizard.target requires a label.')
  }
  if (
    target.id !== undefined &&
    target.id !== null &&
    typeof target.id !== 'string'
  ) {
    throw new Error('wizard.target.id must be a string when supplied.')
  }
  if (typeof input.scope !== 'string' || !SCOPES.has(input.scope)) {
    throw new Error('wizard.scope must use a supported rule scope.')
  }
  return input as unknown as ImporterV2RuleWizardInput
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const body = object(await request.json())
    if (!body || (body.mode !== 'PREVIEW' && body.mode !== 'APPLY')) {
      throw new Error('mode must be PREVIEW or APPLY.')
    }
    const wizard = parseWizard(body.wizard)
    if (body.mode === 'PREVIEW') {
      return NextResponse.json({
        data: await previewImporterV2GuidedRule({ batchId, wizard }),
      })
    }
    if (typeof body.scopeToken !== 'string' || !body.scopeToken) {
      throw new Error('scopeToken is required when activating an automation.')
    }
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({
      data: await applyImporterV2GuidedRule({
        batchId,
        wizard,
        scopeToken: body.scopeToken,
        actorUserId: session?.user.id ?? null,
      }),
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to process importer automation.'
    const stale = message.includes('changed after preview')
    return NextResponse.json(
      {
        error: {
          code: stale ? 'STALE_RULE_PREVIEW' : 'IMPORTER_RULE_WIZARD_FAILED',
          message,
        },
      },
      { status: stale ? 409 : 400 },
    )
  }
}
