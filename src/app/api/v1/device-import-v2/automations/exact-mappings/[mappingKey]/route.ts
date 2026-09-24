import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { deactivateImporterV2ManagedExactMapping } from '@/lib/importer-v2-automation-admin-store'

type RouteContext = {
  params: Promise<{ mappingKey: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { mappingKey } = await context.params
    const body = (await request.json()) as { action?: unknown }
    if (body.action !== 'DEACTIVATE') {
      throw new Error('action must be DEACTIVATE.')
    }
    const session = await auth.api.getSession({ headers: request.headers })
    const mapping = await deactivateImporterV2ManagedExactMapping({
      mappingKey,
      createdByUserId: session?.user.id ?? null,
    })
    return NextResponse.json({
      data: {
        mappingKey: mapping.mappingKey,
        version: mapping.version,
        isActive: mapping.isActive,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to update remembered exact mapping.'
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_EXACT_MAPPING_UPDATE_FAILED',
          message,
        },
      },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}
