import { describe, expect, it } from 'vitest'
import {
  buildImporterV2ScaleFixture,
  IMPORTER_V2_BASELINE_ROW_COUNT,
  IMPORTER_V2_REGRESSION_FIXTURES,
  type ImporterV2Scenario,
} from '@/lib/importer-v2-regression-fixtures'

const REQUIRED_SCENARIOS: ImporterV2Scenario[] = [
  'HIERARCHY',
  'FIRMWARE_BLANK_PRIMARY',
  'FIRMWARE_CHOICE_REQUIRED',
  'CISCO_ROMMON_EVIDENCE',
  'AOS_S_BOOT_RUNNING_EVIDENCE',
  'PLACEHOLDER_FIRMWARE',
  'STACK_MEMBER_SERIAL_REUSE',
  'REPEATED_NAME',
  'SOURCE_DUPLICATE',
  'EXCLUDED_DEVICE_TYPE',
  'UNMANAGED_EOL',
  'AMBIGUOUS_IDENTITY',
]

describe('Importer v2 synthetic regression fixtures', () => {
  it('covers every rebuild-boundary regression shape', () => {
    const scenarios = new Set(
      IMPORTER_V2_REGRESSION_FIXTURES.map((fixture) => fixture.scenario),
    )

    expect(scenarios).toEqual(new Set(REQUIRED_SCENARIOS))
  })

  it('uses the Customer -> Business unit -> Site hierarchy', () => {
    const fixture = IMPORTER_V2_REGRESSION_FIXTURES.find(
      (row) => row.scenario === 'HIERARCHY',
    )

    expect(fixture?.source.customer).toBeTruthy()
    expect(fixture?.source.businessUnit).toBeTruthy()
    expect(fixture?.source.site).toBeTruthy()
  })

  it('preserves both firmware evidence columns when a user decision is required', () => {
    const evidenceCases = IMPORTER_V2_REGRESSION_FIXTURES.filter(
      (row) => row.expected.requiresFirmwareChoice,
    )

    expect(evidenceCases.length).toBeGreaterThanOrEqual(4)
    expect(
      evidenceCases.some((row) => row.source.firmwareVersion === null),
    ).toBe(true)
    expect(
      evidenceCases.every(
        (row) =>
          row.source.firmwareVersion !== undefined &&
          row.source.softwareVersion,
      ),
    ).toBeTruthy()
  })

  it('does not treat repeated names as identity', () => {
    const repeatedNames = IMPORTER_V2_REGRESSION_FIXTURES.filter(
      (row) => row.scenario === 'REPEATED_NAME',
    )

    expect(
      new Set(repeatedNames.map((row) => row.source.deviceName)),
    ).toHaveLength(1)
    expect(
      new Set(repeatedNames.map((row) => row.source.sourceId)),
    ).toHaveLength(2)
    expect(
      new Set(repeatedNames.map((row) => row.source.serialNumber)),
    ).toHaveLength(2)
  })

  it('requires identity-bearing fixture rows to provide a durable identifier', () => {
    for (const fixture of IMPORTER_V2_REGRESSION_FIXTURES) {
      expect(
        Boolean(
          fixture.source.sourceId ||
          fixture.source.serialNumber ||
          fixture.source.macAddress,
        ),
      ).toBe(true)
    }
  })

  it('contains only synthetic source values', () => {
    const serialized = JSON.stringify(
      IMPORTER_V2_REGRESSION_FIXTURES,
    ).toLocaleLowerCase('en-US')

    expect(serialized).toContain('synthetic')
    expect(serialized).not.toMatch(/dhl|unica|leger des heils|working spirit/)
    expect(serialized).not.toMatch(
      /\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    )
  })

  it('generates 12,000 stable, uniquely identified rows without a production workbook', () => {
    const rows = buildImporterV2ScaleFixture()

    expect(rows).toHaveLength(IMPORTER_V2_BASELINE_ROW_COUNT)
    expect(new Set(rows.map((row) => row.source.sourceId))).toHaveLength(
      rows.length,
    )
    expect(new Set(rows.map((row) => row.source.serialNumber))).toHaveLength(
      rows.length,
    )
    expect(new Set(rows.map((row) => row.source.macAddress))).toHaveLength(
      rows.length,
    )
    expect(rows[0].rowNumber).toBe(2)
    expect(rows.at(-1)?.rowNumber).toBe(IMPORTER_V2_BASELINE_ROW_COUNT + 1)
  })
})
