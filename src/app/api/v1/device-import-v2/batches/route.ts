import { NextResponse } from 'next/server'
import { listImporterV2WorkspaceBatches } from '@/lib/importer-v2-workspace-store'
import {
  type ImporterV2XlsxStageConfig,
} from '@/lib/importer-v2-ingestion-store'
import {
  recomputeImporterV2WorkspaceRows,
  stageImporterV2XlsxWithAutomation,
} from '@/lib/importer-v2-workspace-maintenance'
import { ensureImporterV2DerivedStackSourceIdentities } from '@/lib/importer-v2-stack-identity-store'
import { XlsxImportError } from '@/lib/xlsx-reader'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseStageConfig(value: FormDataEntryValue | null): ImporterV2XlsxStageConfig {
  if (typeof value !== 'string') throw new Error('Importer staging configuration is required.')
  const parsed = object(JSON.parse(value))
  if (!parsed) throw new Error('Importer staging configuration must be an object.')
  if (typeof parsed.provider !== 'string' || !parsed.provider.trim()) throw new Error('Provider is required.')
  if (typeof parsed.sourceAdapterId !== 'string' || !parsed.sourceAdapterId.trim()) throw new Error('Source adapter is required.')
  if (typeof parsed.sheetName !== 'string' || !parsed.sheetName.trim()) throw new Error('Worksheet is required.')
  if (
    typeof parsed.headerRow !== 'number' ||
    !Number.isInteger(parsed.headerRow) ||
    parsed.headerRow < 1
  ) {
    throw new Error('Header row must be a positive integer.')
  }
  if (!Array.isArray(parsed.columnMappings)) throw new Error('Column mappings are required.')
  if (parsed.confirmProfile !== true) throw new Error('Confirm the source profile before staging.')
  return parsed as unknown as ImporterV2XlsxStageConfig
}

export async function GET() {
  try {
    return NextResponse.json({ data: await listImporterV2WorkspaceBatches() })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'IMPORTER_WORKSPACE_ERROR', message: error instanceof Error ? error.message : 'Unable to load staged importer batches.' } },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'XLSX_FILE_REQUIRED', message: 'Choose an XLSX workbook.' } },
        { status: 400 },
      )
    }
    const config = parseStageConfig(formData.get('config'))
    const data = await stageImporterV2XlsxWithAutomation({ file, config })
    const derivedStackIdentity = await ensureImporterV2DerivedStackSourceIdentities(data.batch.id)
    const finalState = derivedStackIdentity.appliedCount > 0
      ? await recomputeImporterV2WorkspaceRows({ batchId: data.batch.id })
      : data.automation

    return NextResponse.json({
      data: {
        ...data,
        automation: {
          ...data.automation,
          ...finalState,
          automaticDecisionsApplied:
            (data.automation.automaticDecisionsApplied ?? 0) + derivedStackIdentity.appliedCount,
          derivedStackSourceIdsApplied: derivedStackIdentity.appliedCount,
          repairedStackIdentityCount: derivedStackIdentity.repairedIdentityCount,
        },
      },
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The workbook could not be staged.'
    return NextResponse.json(
      {
        error: {
          code: error instanceof SyntaxError
            ? 'INVALID_IMPORTER_V2_STAGE_CONFIG'
            : error instanceof XlsxImportError
              ? error.code
              : 'IMPORTER_V2_STAGE_FAILED',
          message,
        },
      },
      { status: 400 },
    )
  }
}
