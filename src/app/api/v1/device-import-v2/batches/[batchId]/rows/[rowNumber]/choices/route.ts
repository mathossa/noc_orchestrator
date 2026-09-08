import { NextResponse } from 'next/server'
import { IMPORTER_V2_FIELDS, type ImporterV2Field } from '@/lib/importer-v2-evaluator'
import { listImporterV2CanonicalChoices } from '@/lib/importer-v2-canonical-choices'

type RouteContext = {
  params: Promise<{ batchId: string; rowNumber: string }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { batchId, rowNumber: rawRowNumber } = await context.params
    const rowNumber = Number.parseInt(rawRowNumber, 10)
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      throw new Error('rowNumber must be a positive integer.')
    }

    const url = new URL(request.url)
    const field = url.searchParams.get('field') as ImporterV2Field | null
    if (!field || !IMPORTER_V2_FIELDS.includes(field)) {
      throw new Error('field must be a supported importer field.')
    }

    const query = url.searchParams.get('q')
    return NextResponse.json({
      data: await listImporterV2CanonicalChoices({
        batchId,
        rowNumber,
        field,
        query,
      }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'IMPORTER_CHOICES_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to load canonical choices.',
        },
      },
      { status: 400 },
    )
  }
}
