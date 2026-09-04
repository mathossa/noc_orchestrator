import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyImporterV2FirmwareProofDecisions,
  buildImporterV2FirmwarePublicationProposals,
  groupImporterV2FirmwareProofs,
  interpretImporterV2Firmware,
  type ImporterV2FirmwareInterpretationContext,
  type ImporterV2FirmwareProofRow,
} from '@/lib/importer-v2-firmware'

const context: ImporterV2FirmwareInterpretationContext = {
  compatibilityVersion: 'compat-v1',
  compatibilityRules: [
    {
      id: 'cisco-c9300',
      vendor: 'Cisco',
      model: 'C9300-24P',
      platforms: ['IOS-XE'],
    },
    {
      id: 'aruba-2930f',
      vendor: 'HPE Aruba Networking',
      model: '2930F-48G',
      platforms: ['AOS-S'],
    },
    {
      id: 'aruba-ap515',
      vendor: 'HPE Aruba Networking',
      model: 'AP-515',
      platforms: ['AOS-8', 'AOS-10'],
    },
    {
      id: 'fortigate-100f',
      vendor: 'Fortinet',
      model: 'FortiGate 100F',
      platforms: ['FortiGate'],
    },
  ],
}

function warningCodes(
  result: ReturnType<typeof interpretImporterV2Firmware>,
) {
  return result.warnings.map((warning) => warning.code)
}

describe('Importer v2 deterministic firmware interpreter', () => {
  it('stays pure and cannot create canonical firmware or platform records', () => {
    const source = readFileSync(
      new URL('./importer-v2-firmware.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(
      /@\/lib\/prisma|firmwareRelease\.(create|update|upsert)|softwarePlatform\.(create|update|upsert)/,
    )
  })

  it('uses Software Version when Firmware Version is blank', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Example Networks',
        firmwareVersion: null,
        softwareVersion: 'ExampleOS 10.4.3 build 711',
      },
      context,
    )

    expect(result.runningVersion).toBe('10.4.3')
    expect(result.decisionId).toBe('blank-firmware-software-running')
    expect(result.confidence).toBe('MEDIUM')
    expect(result.rawEvidence.firmwareVersion).toBeNull()
    expect(result.rawEvidence.softwareVersion).toBe(
      'ExampleOS 10.4.3 build 711',
    )
  })

  it('retains a placeholder firmware value as raw evidence but does not use it', () => {
    const result = interpretImporterV2Firmware(
      {
        firmwareVersion: '0.1',
        softwareVersion: 'ExampleOS 10.4.4 build 712',
      },
      context,
    )

    expect(result.runningVersion).toBe('10.4.4')
    expect(result.rawEvidence.firmwareVersion).toBe('0.1')
    expect(warningCodes(result)).toContain('PLACEHOLDER_FIRMWARE_IGNORED')
  })

  it.each(['16.12(3r)', '17.5(1r)'])(
    'separates Cisco ROMMON %s from running IOS-XE',
    (rommon: string) => {
      const result = interpretImporterV2Firmware(
        {
          vendor: 'Cisco',
          model: 'C9300-24P',
          firmwareVersion: rommon,
          softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
        },
        context,
      )

      expect(result.runningVersion).toBe('17.12.05')
      expect(result.proposedSoftwarePlatform).toBe('IOS-XE')
      expect(result.decisionId).toBe('cisco-rommon-software-running')
      expect(result.compatibility.status).toBe('COMPATIBLE')
      expect(warningCodes(result)).toContain('BOOT_FIRMWARE_IGNORED')
    },
  )

  it('does not treat ROMMON-only evidence as a running release', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Cisco',
        model: 'C9300-24P',
        firmwareVersion: '17.5(1r)',
      },
      context,
    )

    expect(result.runningVersion).toBeNull()
    expect(result.confidence).toBe('LOW')
    expect(warningCodes(result)).toContain('UNKNOWN_RUNNING_FIRMWARE')
  })

  it('uses Aruba AOS-S software instead of differing boot firmware', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'HPE Aruba Networking',
        model: '2930F-48G',
        firmwareVersion: 'WC.16.01.0010',
        softwareVersion: 'WC.16.11.0002',
      },
      context,
    )

    expect(result.runningVersion).toBe('WC.16.11.0002')
    expect(result.proposedSoftwarePlatform).toBe('AOS-S')
    expect(result.compatibility.status).toBe('COMPATIBLE')
    expect(warningCodes(result)).toContain('BOOT_FIRMWARE_IGNORED')
  })

  it.each([
    ['ArubaOS 8.10.0.20_93760', 'AOS-8'],
    ['ArubaOS 10.7.1.2_99999', 'AOS-10'],
  ])(
    'infers Aruba WLAN platform from deployment/version evidence: %s',
    (software: string, platform: string) => {
      const result = interpretImporterV2Firmware(
        {
          vendor: 'HPE Aruba Networking',
          model: 'AP-515',
          sourceDeviceType: 'Access Point',
          softwareVersion: software,
        },
        context,
      )

      expect(result.proposedSoftwarePlatform).toBe(platform)
      expect(result.platformEvidence).toBe('VERSION_EVIDENCE')
      expect(result.compatibility.status).toBe('COMPATIBLE')
    },
  )

  it('does not classify a multi-platform Aruba model from model name alone', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'HPE Aruba Networking',
        model: 'AP-515',
      },
      context,
    )

    expect(result.proposedSoftwarePlatform).toBeNull()
    expect(result.platformEvidence).toBe('NONE')
    expect(result.runningVersion).toBeNull()
    expect(result.confidence).toBe('LOW')
  })

  it.each([
    [
      'FortiGate',
      'FortiGate 100F',
      'FortiGate-100F v7.4.0,build2303,230307 (GA)',
      'FortiGate',
      '7.4.0',
    ],
    [
      'FortiSwitch',
      'FortiSwitch 248E-FPOE',
      'FortiSwitch-248E-FPOE v7.4.8,build0822,250410 (GA)',
      'FortiSwitch',
      '7.4.8',
    ],
    [
      'FortiAP',
      'FortiAP 231F',
      'FortiAP-231F v7.4.5,build0678,250101 (GA)',
      'FortiAP',
      '7.4.5',
    ],
  ])(
    'extracts %s verbose versions deterministically',
    (
      sourceDeviceType: string,
      model: string,
      softwareVersion: string,
      platform: string,
      version: string,
    ) => {
      const result = interpretImporterV2Firmware(
        {
          vendor: 'Fortinet',
          model,
          sourceDeviceType,
          softwareVersion,
        },
        context,
      )

      expect(result.runningVersion).toBe(version)
      expect(result.proposedSoftwarePlatform).toBe(platform)
    },
  )

  it('recognizes the exact same release expressed with verbose vendor text', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Fortinet',
        firmwareVersion: 'FortiGate-301E v7.4.0,build2303',
        softwareVersion: 'FortiOS v7.4.0 build2303',
      },
      context,
    )

    expect(result.runningVersion).toBe('7.4.0')
    expect(result.decisionId).toBe('same-release-both-columns')
    expect(result.confidence).toBe('HIGH')
  })

  it('keeps conflicting generic firmware evidence unresolved instead of guessing', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Example Networks',
        firmwareVersion: '10.3.9',
        softwareVersion: 'ExampleOS 10.4.3 build 711',
      },
      context,
    )

    expect(result.runningVersion).toBeNull()
    expect(result.confidence).toBe('LOW')
    expect(warningCodes(result)).toEqual(
      expect.arrayContaining([
        'FIRMWARE_EVIDENCE_CONFLICT',
        'UNKNOWN_RUNNING_FIRMWARE',
      ]),
    )
  })

  it('checks an inferred platform against model compatibility and warns on mismatch', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Cisco',
        model: 'C9300-24P',
        softwarePlatform: 'IOS',
        softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
      },
      context,
    )

    expect(result.proposedSoftwarePlatform).toBe('IOS-XE')
    expect(result.compatibility.status).toBe('COMPATIBLE')
    expect(result.confidence).toBe('LOW')
    expect(warningCodes(result)).toContain('PLATFORM_EVIDENCE_CONFLICT')
  })

  it('downgrades deterministic confidence when model-platform compatibility rejects the proposal', () => {
    const incompatibleContext: ImporterV2FirmwareInterpretationContext = {
      compatibilityVersion: 'compat-v2',
      compatibilityRules: [
        {
          id: 'cisco-c9300-ios-only',
          vendor: 'Cisco',
          model: 'C9300-24P',
          platforms: ['IOS'],
        },
      ],
    }
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Cisco',
        model: 'C9300-24P',
        softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
      },
      incompatibleContext,
    )

    expect(result.proposedSoftwarePlatform).toBe('IOS-XE')
    expect(result.compatibility.status).toBe('INCOMPATIBLE')
    expect(result.confidence).toBe('LOW')
    expect(warningCodes(result)).toContain('PLATFORM_INCOMPATIBLE')
  })

  it('does not use product family as a compatibility substitute', () => {
    const result = interpretImporterV2Firmware(
      {
        vendor: 'Cisco',
        model: 'Unknown Catalyst',
        productFamily: 'Catalyst 9000',
        softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
      },
      context,
    )

    expect(result.proposedSoftwarePlatform).toBe('IOS-XE')
    expect(result.compatibility.status).toBe('UNKNOWN')
    expect(result.compatibility.ruleId).toBeNull()
  })
})

describe('Importer v2 firmware proof groups', () => {
  function proofRow(
    rowNumber: number,
    customer: string,
    deviceName: string,
  ): ImporterV2FirmwareProofRow {
    return {
      rowNumber,
      rowFingerprint: `row-${rowNumber}`,
      customer,
      model: 'C9300-24P',
      deviceName,
      interpretation: interpretImporterV2Firmware(
        {
          vendor: 'Cisco',
          model: 'C9300-24P',
          firmwareVersion: '17.5(1r)',
          softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
        },
        context,
      ),
    }
  }

  it('groups an identical evidence decision and exposes scope and samples', () => {
    const rows = [
      proofRow(2, 'Customer A', 'core-a'),
      proofRow(3, 'Customer B', 'core-b'),
      proofRow(4, 'Customer A', 'core-c'),
    ]

    const groups = groupImporterV2FirmwareProofs(rows, 2)

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].customers).toEqual(['Customer A', 'Customer B'])
    expect(groups[0].models).toEqual(['C9300-24P'])
    expect(groups[0].sampleDevices).toHaveLength(2)
    expect(groups[0].requiresConfirmation).toBe(true)
  })

  it('applies one approval to every row in the evidence group', () => {
    const rows = [
      proofRow(2, 'Customer A', 'core-a'),
      proofRow(3, 'Customer B', 'core-b'),
    ]
    const group = groupImporterV2FirmwareProofs(rows)[0]

    const reviewed = applyImporterV2FirmwareProofDecisions(
      rows,
      [{ id: 'approve-1', groupKey: group.key, action: 'APPROVE' }],
      context,
    )

    expect(reviewed.map((row) => row.review.status)).toEqual([
      'APPROVED',
      'APPROVED',
    ])
  })

  it('applies one correction to the group and rechecks compatibility', () => {
    const rows = [
      proofRow(2, 'Customer A', 'core-a'),
      proofRow(3, 'Customer B', 'core-b'),
    ]
    const group = groupImporterV2FirmwareProofs(rows)[0]

    const reviewed = applyImporterV2FirmwareProofDecisions(
      rows,
      [
        {
          id: 'correct-1',
          groupKey: group.key,
          action: 'CORRECT',
          runningVersion: '17.12.06',
          softwarePlatform: 'IOS-XE',
          explanation: 'Engineer verified the source evidence pattern.',
        },
      ],
      context,
    )

    expect(
      reviewed.every(
        (row) => row.interpretation.runningVersion === '17.12.06',
      ),
    ).toBe(true)
    expect(reviewed.every((row) => row.review.status === 'CORRECTED')).toBe(true)
    expect(reviewed[0].interpretation.compatibility.status).toBe('COMPATIBLE')
  })

  it('only builds staged observed-state proposals after proof review', () => {
    const rows = [
      proofRow(2, 'Customer A', 'core-a'),
      proofRow(3, 'Customer B', 'core-b'),
    ]
    const group = groupImporterV2FirmwareProofs(rows)[0]
    const reviewed = applyImporterV2FirmwareProofDecisions(
      rows,
      [{ id: 'approve-1', groupKey: group.key, action: 'APPROVE' }],
      context,
    )
    const proposals = buildImporterV2FirmwarePublicationProposals(reviewed)

    expect(proposals).toHaveLength(2)
    expect(proposals[0]).toMatchObject({
      observedRunningVersion: '17.12.05',
      proposedSoftwarePlatform: 'IOS-XE',
      canonicalReleaseId: null,
      canonicalPlatformId: null,
      observedReleaseState: 'OBSERVED_AVAILABLE',
      proofDecisionId: 'approve-1',
    })
  })

  it('never publishes a pending group', () => {
    const rows = [proofRow(2, 'Customer A', 'core-a')]
    const reviewed = applyImporterV2FirmwareProofDecisions(rows, [], context)
    expect(buildImporterV2FirmwarePublicationProposals(reviewed)).toEqual([])
  })
})
