export const IMPORTER_V2_BASELINE_ROW_COUNT = 12_000

export type ImporterV2Disposition =
  | 'READY_FOR_REVIEW'
  | 'IDENTITY_CONFLICT'
  | 'SOURCE_DUPLICATE_CONFLICT'
  | 'EXCLUDED_BY_RULE'

export type ImporterV2Scenario =
  | 'HIERARCHY'
  | 'FIRMWARE_BLANK_PRIMARY'
  | 'FIRMWARE_CHOICE_REQUIRED'
  | 'CISCO_ROMMON_EVIDENCE'
  | 'AOS_S_BOOT_RUNNING_EVIDENCE'
  | 'PLACEHOLDER_FIRMWARE'
  | 'STACK_MEMBER_SERIAL_REUSE'
  | 'REPEATED_NAME'
  | 'SOURCE_DUPLICATE'
  | 'EXCLUDED_DEVICE_TYPE'
  | 'UNMANAGED_EOL'
  | 'AMBIGUOUS_IDENTITY'

export type ImporterV2SyntheticRow = {
  rowNumber: number
  scenario: ImporterV2Scenario
  source: {
    provider: string
    sourceId: string | null
    customer: string
    businessUnit: string
    site: string
    deviceName: string
    serialNumber: string | null
    macAddress: string | null
    vendor: string
    productFamily: string
    softwarePlatform: string
    model: string
    deviceType: string
    firmwareVersion: string | null
    softwareVersion: string | null
    managed: boolean
    lifecycle: 'SUPPORTED' | 'END_OF_LIFE'
  }
  expected: {
    disposition: ImporterV2Disposition
    requiresFirmwareChoice?: boolean
    preserveRawFirmware?: boolean
    flags?: Array<'UNMANAGED' | 'END_OF_LIFE'>
  }
}

const source = (
  overrides: Partial<ImporterV2SyntheticRow['source']> = {},
): ImporterV2SyntheticRow['source'] => ({
  provider: 'SyntheticCMDB',
  sourceId: 'synthetic-device-001',
  customer: 'Northwind Transit',
  businessUnit: 'Parcel Operations',
  site: 'Harbor Campus',
  deviceName: 'edge-sw-001',
  serialNumber: 'SYNTH-SERIAL-001',
  macAddress: '02:00:00:00:00:01',
  vendor: 'Example Networks',
  productFamily: 'Campus Switches',
  softwarePlatform: 'ExampleOS',
  model: 'EX-2400-24P',
  deviceType: 'Switch',
  firmwareVersion: '10.4.2',
  softwareVersion: 'ExampleOS 10.4.2 build 710',
  managed: true,
  lifecycle: 'SUPPORTED',
  ...overrides,
})

export const IMPORTER_V2_REGRESSION_FIXTURES: readonly ImporterV2SyntheticRow[] =
  [
    {
      rowNumber: 2,
      scenario: 'HIERARCHY',
      source: source(),
      expected: { disposition: 'READY_FOR_REVIEW' },
    },
    {
      rowNumber: 3,
      scenario: 'FIRMWARE_BLANK_PRIMARY',
      source: source({
        sourceId: 'synthetic-device-002',
        serialNumber: 'SYNTH-SERIAL-002',
        macAddress: '02:00:00:00:00:02',
        deviceName: 'edge-sw-002',
        firmwareVersion: null,
        softwareVersion: 'ExampleOS 10.4.3 build 711',
      }),
      expected: {
        disposition: 'READY_FOR_REVIEW',
        requiresFirmwareChoice: true,
      },
    },
    {
      rowNumber: 4,
      scenario: 'FIRMWARE_CHOICE_REQUIRED',
      source: source({
        sourceId: 'synthetic-device-003',
        serialNumber: 'SYNTH-SERIAL-003',
        macAddress: '02:00:00:00:00:03',
        deviceName: 'edge-sw-003',
        firmwareVersion: '10.3.9',
        softwareVersion: 'ExampleOS 10.4.3 build 711',
      }),
      expected: {
        disposition: 'READY_FOR_REVIEW',
        requiresFirmwareChoice: true,
      },
    },
    {
      rowNumber: 5,
      scenario: 'CISCO_ROMMON_EVIDENCE',
      source: source({
        sourceId: 'synthetic-device-004',
        serialNumber: 'SYNTH-SERIAL-004',
        macAddress: '02:00:00:00:00:04',
        vendor: 'Cisco',
        productFamily: 'Catalyst',
        softwarePlatform: 'IOS XE',
        model: 'C9X00-LAB',
        deviceName: 'core-rtr-001',
        firmwareVersion: '17.5(1r)',
        softwareVersion: 'IOS XE 17.9.5',
      }),
      expected: {
        disposition: 'READY_FOR_REVIEW',
        requiresFirmwareChoice: true,
      },
    },
    {
      rowNumber: 6,
      scenario: 'AOS_S_BOOT_RUNNING_EVIDENCE',
      source: source({
        sourceId: 'synthetic-device-005',
        serialNumber: 'SYNTH-SERIAL-005',
        macAddress: '02:00:00:00:00:05',
        vendor: 'HPE Aruba Networking',
        productFamily: 'Aruba Switch',
        softwarePlatform: 'AOS-S',
        model: '29XX-LAB',
        deviceName: 'access-sw-001',
        firmwareVersion: 'WC.16.01.0010',
        softwareVersion: 'WC.16.11.0002',
      }),
      expected: {
        disposition: 'READY_FOR_REVIEW',
        requiresFirmwareChoice: true,
      },
    },
    {
      rowNumber: 7,
      scenario: 'PLACEHOLDER_FIRMWARE',
      source: source({
        sourceId: 'synthetic-device-006',
        serialNumber: 'SYNTH-SERIAL-006',
        macAddress: '02:00:00:00:00:06',
        deviceName: 'edge-fw-001',
        firmwareVersion: '0.1',
        softwareVersion: 'ExampleOS 10.4.4 build 712',
      }),
      expected: {
        disposition: 'READY_FOR_REVIEW',
        requiresFirmwareChoice: true,
        preserveRawFirmware: true,
      },
    },
    {
      rowNumber: 8,
      scenario: 'STACK_MEMBER_SERIAL_REUSE',
      source: source({
        sourceId: 'synthetic-stack-member-a',
        serialNumber: 'SYNTH-SHARED-STACK-SERIAL',
        macAddress: '02:00:00:00:10:01',
        deviceName: 'stack-member-a',
      }),
      expected: { disposition: 'IDENTITY_CONFLICT' },
    },
    {
      rowNumber: 9,
      scenario: 'STACK_MEMBER_SERIAL_REUSE',
      source: source({
        sourceId: 'synthetic-stack-member-b',
        serialNumber: 'SYNTH-SHARED-STACK-SERIAL',
        macAddress: '02:00:00:00:10:02',
        deviceName: 'stack-member-b',
      }),
      expected: { disposition: 'IDENTITY_CONFLICT' },
    },
    {
      rowNumber: 10,
      scenario: 'REPEATED_NAME',
      source: source({
        sourceId: 'synthetic-device-007',
        serialNumber: 'SYNTH-SERIAL-007',
        macAddress: '02:00:00:00:00:07',
        deviceName: 'reused-access-name',
        site: 'North Campus',
      }),
      expected: { disposition: 'READY_FOR_REVIEW' },
    },
    {
      rowNumber: 11,
      scenario: 'REPEATED_NAME',
      source: source({
        sourceId: 'synthetic-device-008',
        serialNumber: 'SYNTH-SERIAL-008',
        macAddress: '02:00:00:00:00:08',
        deviceName: 'reused-access-name',
        site: 'South Campus',
      }),
      expected: { disposition: 'READY_FOR_REVIEW' },
    },
    {
      rowNumber: 12,
      scenario: 'SOURCE_DUPLICATE',
      source: source({
        sourceId: 'synthetic-duplicate-001',
        serialNumber: 'SYNTH-DUPLICATE-001',
        macAddress: '02:00:00:00:20:01',
        deviceName: 'duplicate-source-row',
        firmwareVersion: '10.4.1',
      }),
      expected: { disposition: 'SOURCE_DUPLICATE_CONFLICT' },
    },
    {
      rowNumber: 13,
      scenario: 'SOURCE_DUPLICATE',
      source: source({
        sourceId: 'synthetic-duplicate-001',
        serialNumber: 'SYNTH-DUPLICATE-001',
        macAddress: '02:00:00:00:20:01',
        deviceName: 'duplicate-source-row',
        firmwareVersion: '10.4.2',
      }),
      expected: { disposition: 'SOURCE_DUPLICATE_CONFLICT' },
    },
    {
      rowNumber: 14,
      scenario: 'EXCLUDED_DEVICE_TYPE',
      source: source({
        sourceId: 'synthetic-excluded-001',
        serialNumber: 'SYNTH-EXCLUDED-001',
        macAddress: '02:00:00:00:30:01',
        deviceName: 'excluded-endpoint',
        deviceType: 'Workstation',
      }),
      expected: { disposition: 'EXCLUDED_BY_RULE' },
    },
    {
      rowNumber: 15,
      scenario: 'UNMANAGED_EOL',
      source: source({
        sourceId: 'synthetic-device-009',
        serialNumber: 'SYNTH-SERIAL-009',
        macAddress: '02:00:00:00:00:09',
        deviceName: 'legacy-edge-001',
        managed: false,
        lifecycle: 'END_OF_LIFE',
      }),
      expected: {
        disposition: 'READY_FOR_REVIEW',
        flags: ['UNMANAGED', 'END_OF_LIFE'],
      },
    },
    {
      rowNumber: 16,
      scenario: 'AMBIGUOUS_IDENTITY',
      source: source({
        sourceId: 'synthetic-conflict-device-a',
        serialNumber: 'SYNTH-CONFLICT-DEVICE-B',
        macAddress: '02:00:00:00:40:01',
        deviceName: 'identity-conflict',
      }),
      expected: { disposition: 'IDENTITY_CONFLICT' },
    },
  ] as const

function hexOctet(value: number) {
  return value.toString(16).padStart(2, '0')
}

export function buildImporterV2ScaleFixture(
  rowCount = IMPORTER_V2_BASELINE_ROW_COUNT,
): ImporterV2SyntheticRow[] {
  if (!Number.isInteger(rowCount) || rowCount < 1) {
    throw new RangeError(
      'Importer v2 fixture row count must be a positive integer.',
    )
  }

  return Array.from({ length: rowCount }, (_unused, index) => {
    const sequence = index + 1
    const template =
      IMPORTER_V2_REGRESSION_FIXTURES[
        index % IMPORTER_V2_REGRESSION_FIXTURES.length
      ]
    const high = Math.floor(index / 65_536) % 256
    const middle = Math.floor(index / 256) % 256
    const low = index % 256

    return {
      ...template,
      rowNumber: sequence + 1,
      source: {
        ...template.source,
        sourceId: `scale-source-${sequence.toString().padStart(6, '0')}`,
        serialNumber: `SCALE-SERIAL-${sequence.toString().padStart(6, '0')}`,
        macAddress: `02:7f:${hexOctet(high)}:${hexOctet(middle)}:${hexOctet(low)}:${hexOctet((index * 17) % 256)}`,
        deviceName: `scale-device-${sequence.toString().padStart(6, '0')}`,
      },
      expected: {
        ...template.expected,
        disposition:
          template.expected.disposition === 'EXCLUDED_BY_RULE'
            ? 'EXCLUDED_BY_RULE'
            : 'READY_FOR_REVIEW',
      },
    }
  })
}
