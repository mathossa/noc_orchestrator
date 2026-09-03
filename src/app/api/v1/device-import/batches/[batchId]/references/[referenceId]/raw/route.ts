import { NextResponse } from 'next/server'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ batchId: string; referenceId: string }> }

const DEFAULT_RAW_ROW_LIMIT = 3
const MAX_RAW_ROW_LIMIT = 50

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function requestedLimit(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get('limit'))
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_RAW_ROW_LIMIT
  return Math.min(raw, MAX_RAW_ROW_LIMIT)
}

export async function GET(request: Request, context: RouteContext) {
  const { batchId, referenceId } = await context.params
  try {
    const reference = await prisma.deviceImportStagedReference.findFirst({
      where: { id: referenceId, batchId },
      select: { id: true, kind: true, sourceValue: true, occurrenceCount: true, metadata: true },
    })
    if (!reference) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'The staged reference was not found.' } }, { status: 404 })
    }
    const limit = requestedLimit(request)
    const rowNumbers = (metadata(reference.metadata).rowNumbers ?? []).slice(0, limit)
    const rows = rowNumbers.length
      ? await prisma.deviceImportStagedRow.findMany({
          where: { batchId, rowNumber: { in: rowNumbers } },
          orderBy: { rowNumber: 'asc' },
          select: { rowNumber: true, status: true, rawData: true, mappedData: true },
        })
      : []
    return NextResponse.json({
      data: {
        sourceValue: reference.sourceValue,
        kind: reference.kind,
        occurrenceCount: reference.occurrenceCount,
        sampled: reference.occurrenceCount > rows.length,
        rows,
      },
    })
  } catch (error) {
    console.error('Failed to load raw staged import rows', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Raw staged rows could not be loaded.' } },
      { status: 500 },
    )
  }
}
