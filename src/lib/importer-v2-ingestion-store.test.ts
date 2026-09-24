import { describe, expect, it } from 'vitest'
import { importerV2CompatibilityRulesFromSupportedPlatforms } from '@/lib/importer-v2-ingestion-store'

describe('Importer v2 catalog compatibility snapshot', () => {
  it('keeps configured supported platforms as separate values for multi-platform models', () => {
    const rules = importerV2CompatibilityRulesFromSupportedPlatforms(
      [
        {
          id: 'ap-205h',
          model: 'Aruba AP-205H',
          vendor: { name: 'HPE Networking' },
        },
      ],
      new Map([
        ['ap-205h', ['AOS-10', 'AOS-8']],
      ]),
    )

    expect(rules).toEqual([
      {
        id: 'device-model:ap-205h',
        vendor: 'HPE Networking',
        model: 'Aruba AP-205H',
        platforms: ['AOS-10', 'AOS-8'],
      },
    ])
    expect(rules[0].platforms).toContain('AOS-8')
    expect(rules[0].platforms).not.toContain('AOS-10, AOS-8')
  })
})
