import { NextResponse } from 'next/server'
import { rememberReviewedBatchReferences } from '@/lib/device-import-staged-profile-aliases'
import { bulkCreateDeviceImportSites, getDeviceImportSiteCreateProposals } from '@/lib/device-import-staged-site-bulk-create'
import {
  countNormalizableStagedGenericSites,
  normalizeExistingStagedGenericSites,
} from '@/lib/device-import-staged-site-normalize'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const [proposals, normalizableGenericRowCount] = await Promise.all([
      getDeviceImportSiteCreateProposals(batchId),
      countNormalizableStagedGenericSites(batchId),
    ])
    return NextResponse.json({ data: { ...proposals, normalizableGenericRowCount } })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_BULK_SITE_CREATE', message: error.message } }, { status: 400 })
    }
    console.error('Failed to prepare staged import Sites', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged Site proposals could not be prepared.' } },
      { status: 500 },
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json() as Record<string, unknown>
    if (body.action === 'NORMALIZE_GENERIC_SITES') {
      return NextResponse.json({ data: await normalizeExistingStagedGenericSites(batchId) })
    }
    const data = await bulkCreateDeviceImportSites({ ...body, batchId })
    await rememberReviewedBatchReferences(batchId, ['SITE'])
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_BULK_SITE_CREATE', message: error.message } }, { status: 400 })
    }
    console.error('Failed to bulk-create staged import Sites', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged Sites could not be created.' } },
      { status: 500 },
    )
  }
}
