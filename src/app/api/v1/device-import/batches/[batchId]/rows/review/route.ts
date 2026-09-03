import { NextResponse } from 'next/server'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ batchId: string }> }

const MAX_ROWS = 1000

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const batch = await prisma.deviceImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    })
    if (!batch) throw new DeviceImportStagingError('Import batch was not found.')

    const [rows, grouped] = await Promise.all([
      prisma.deviceImportStagedRow.findMany({
        where: { batchId, status: { in: ['IGNORED', 'EXCLUDED'] } },
        orderBy: { rowNumber: 'asc' },
        take: MAX_ROWS,
        select: {
          id: true,
          rowNumber: true,
          status: true,
          statusReason: true,
          statusSource: true,
          mappedData: true,
        },
      }),
      prisma.deviceImportStagedRow.groupBy({
        by: ['status'],
        where: { batchId, status: { in: ['IGNORED', 'EXCLUDED'] } },
        _count: { _all: true },
      }),
    ])

    const counts = Object.fromEntries(grouped.map((entry) => [entry.status, entry._count._all]))
    const total = grouped.reduce((sum, entry) => sum + entry._count._all, 0)
    return NextResponse.json({
      data: {
        rows,
        counts,
        total,
        returned: rows.length,
        truncated: rows.length < total,
      },
    })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json(
        { error: { code: 'INVALID_IMPORT_BATCH', message: error.message } },
        { status: 404 },
      )
    }
    console.error('Failed to load ignored import rows', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Ignored import rows could not be loaded.' } },
      { status: 500 },
    )
  }
}
