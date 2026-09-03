import { NextResponse } from 'next/server'
import {
  deleteImportProfileAliases,
  DeviceImportProfileAliasError,
} from '@/lib/device-import-profile-alias-store'

type RouteContext = { params: Promise<{ profileId: string }> }

export async function DELETE(request: Request, context: RouteContext) {
  const { profileId } = await context.params
  try {
    const input = await request.json() as { aliasIds?: unknown }
    return NextResponse.json({
      data: await deleteImportProfileAliases(profileId, input.aliasIds),
    })
  } catch (error) {
    if (error instanceof DeviceImportProfileAliasError) {
      return NextResponse.json(
        { error: { code: 'INVALID_PROFILE_ALIAS', message: error.message } },
        { status: 400 },
      )
    }
    console.error('Failed to delete learned import mappings', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The learned mappings could not be deleted.' } },
      { status: 500 },
    )
  }
}
