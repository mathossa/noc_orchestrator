import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { mutateImporterV2ManagedRule } from '@/lib/importer-v2-automation-admin-store'

type RouteContext = {
  params: Promise<{ ruleBookId: string; ruleId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { ruleBookId, ruleId } = await context.params
    const body = (await request.json()) as { action?: unknown }
    if (
      body.action !== 'ENABLE' &&
      body.action !== 'DISABLE' &&
      body.action !== 'REMOVE'
    ) {
      throw new Error('action must be ENABLE, DISABLE or REMOVE.')
    }
    const session = await auth.api.getSession({ headers: request.headers })
    const revision = await mutateImporterV2ManagedRule({
      ruleBookId,
      ruleId,
      action: body.action,
      createdByUserId: session?.user.id ?? null,
    })
    return NextResponse.json({
      data: {
        revisionId: revision.revisionId,
        version: revision.version,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to update importer automation.'
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_AUTOMATION_UPDATE_FAILED',
          message,
        },
      },
      { status: message.includes('not') ? 404 : 400 },
    )
  }
}
