import { bench, describe } from 'vitest'
import {
  evaluateImporterV2,
  type ImporterV2EvaluationInput,
} from '@/lib/importer-v2-evaluator'
import {
  buildImporterV2ScaleFixture,
  type ImporterV2SyntheticRow,
} from '@/lib/importer-v2-regression-fixtures'

const rows = buildImporterV2ScaleFixture()

type StagedRow = ImporterV2SyntheticRow & {
  normalized: {
    customer: string
    businessUnit: string
    site: string
    vendor: string
    model: string
  }
}

function stage(input: ImporterV2SyntheticRow[]): StagedRow[] {
  return input.map((row) => ({
    ...row,
    source: { ...row.source },
    expected: { ...row.expected },
    normalized: {
      customer: row.source.customer
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US'),
      businessUnit: row.source.businessUnit
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US'),
      site: row.source.site.normalize('NFKC').trim().toLocaleLowerCase('en-US'),
      vendor: row.source.vendor
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US'),
      model: row.source.model
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US'),
    },
  }))
}

const staged = stage(rows)

const evaluatorInput: ImporterV2EvaluationInput = {
  profile: {
    id: 'benchmark-profile',
    version: 'benchmark-profile-v1',
    sourceAdapterId: 'synthetic-adapter',
    provider: 'SyntheticCMDB',
    requiredFields: ['customer', 'site', 'vendor', 'model', 'currentFirmware'],
    warnWhenUnresolvedFields: [],
  },
  catalog: { version: 'benchmark-catalog-v1', values: {} },
  rules: {
    version: 'benchmark-rules-v1',
    manualOverrides: [],
    rememberedMappings: [],
    profileRules: [],
  },
  parsers: { version: 'benchmark-parsers-v1', definitions: [] },
  suggestions: { version: 'benchmark-suggestions-v1', suggestions: [] },
  rows: rows.map((row) => ({
    rowNumber: row.rowNumber,
    sourceRecordKey: row.source.sourceId,
    rawValues: {
      customer: row.source.customer,
      businessUnit: row.source.businessUnit,
      site: row.source.site,
      deviceName: row.source.deviceName,
      sourceId: row.source.sourceId,
      serialNumber: row.source.serialNumber,
      macAddress: row.source.macAddress,
      vendor: row.source.vendor,
      productFamily: row.source.productFamily,
      softwarePlatform: row.source.softwarePlatform,
      model: row.source.model,
      deviceType: row.source.deviceType,
      firmwareVersion: row.source.firmwareVersion,
      softwareVersion: row.source.softwareVersion,
    },
    inclusionDecision:
      row.expected.disposition === 'EXCLUDED_BY_RULE'
        ? {
            status: 'EXCLUDED',
            source: 'PROFILE_RULE',
            decisionId: 'benchmark-exclusion-rule',
            explanation: 'Synthetic device type exclusion.',
          }
        : null,
  })),
}

const evaluated = evaluateImporterV2(evaluatorInput)

function filterAndSort() {
  return evaluated.rows
    .filter((row) => row.inclusion !== 'EXCLUDED')
    .toSorted((left, right) =>
      (left.normalizedValues.model ?? '').localeCompare(
        right.normalizedValues.model ?? '',
      ),
    )
}

function validate(input: StagedRow[]) {
  const sourceIds = new Set<string>()
  const serials = new Set<string>()
  const macAddresses = new Set<string>()
  let invalid = 0

  for (const row of input) {
    const { sourceId, serialNumber, macAddress } = row.source
    if (!sourceId && !serialNumber && !macAddress) invalid += 1
    if (sourceId) sourceIds.add(sourceId)
    if (serialNumber) serials.add(serialNumber)
    if (macAddress) macAddresses.add(macAddress)
  }

  return { invalid, sourceIds, serials, macAddresses }
}

function buildPublishPlan(input: StagedRow[]) {
  return input
    .filter((row) => row.expected.disposition === 'READY_FOR_REVIEW')
    .map((row) => ({
      rowNumber: row.rowNumber,
      sourceId: row.source.sourceId,
      before: null,
      after: {
        customer: row.source.customer,
        businessUnit: row.source.businessUnit,
        site: row.source.site,
        serialNumber: row.source.serialNumber,
        macAddress: row.source.macAddress,
        observedFirmwareEvidence: {
          firmwareVersion: row.source.firmwareVersion,
          softwareVersion: row.source.softwareVersion,
        },
      },
    }))
}

describe('Importer v2 12,000-row CPU reference baseline', () => {
  bench('stage', () => {
    stage(rows)
  })

  bench('evaluate', () => {
    evaluateImporterV2(evaluatorInput)
  })

  bench('filter and sort interaction', () => {
    filterAndSort()
  })

  bench('validate', () => {
    validate(staged)
  })

  bench('build publish plan', () => {
    buildPublishPlan(staged)
  })
})
