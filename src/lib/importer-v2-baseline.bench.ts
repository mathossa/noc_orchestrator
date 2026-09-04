import { bench, describe } from 'vitest'
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

function evaluate(input: StagedRow[]) {
  return input.map((row) => ({
    row,
    confidence:
      row.source.sourceId && row.source.serialNumber && row.source.macAddress
        ? 'HIGH'
        : row.source.sourceId ||
            row.source.serialNumber ||
            row.source.macAddress
          ? 'MEDIUM'
          : 'LOW',
    needsFirmwareChoice: Boolean(row.expected.requiresFirmwareChoice),
    disposition: row.expected.disposition,
  }))
}

const evaluated = evaluate(staged)

function filterAndSort() {
  return evaluated
    .filter((row) => row.disposition !== 'EXCLUDED_BY_RULE')
    .toSorted((left, right) =>
      left.row.normalized.model.localeCompare(right.row.normalized.model),
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
    evaluate(staged)
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
