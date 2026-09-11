import { describe, expect, it } from 'vitest'
import { importerV2DerivedStackSourceId } from '@/lib/importer-v2-stack-identity'

describe('Importer v2 derived logical-stack identity', () => {
  it('is deterministic and explicitly marked as derived', () => {
    const input = {
      provider: 'Auvik',
      sourceAdapterId: 'xlsx',
      groupKey: 'auvik|bouwmaatschappij van mierlo||maasdijk|071swi0004.vmierlo.local',
    }
    const first = importerV2DerivedStackSourceId(input)
    const second = importerV2DerivedStackSourceId(input)

    expect(first).toBe(second)
    expect(first).toMatch(/^derived-stack:[0-9a-f]{32}$/)
  })

  it('normalizes casing and whitespace before deriving the crosswalk key', () => {
    const first = importerV2DerivedStackSourceId({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx',
      groupKey: 'Auvik|Customer||Site|Stack 01',
    })
    const second = importerV2DerivedStackSourceId({
      provider: '  AUVIK ',
      sourceAdapterId: 'XLSX',
      groupKey: '  auvik|customer||site|stack   01 ',
    })

    expect(first).toBe(second)
  })

  it('changes when the validated logical stack grouping changes', () => {
    const first = importerV2DerivedStackSourceId({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx',
      groupKey: 'auvik|customer||site-a|stack-01',
    })
    const moved = importerV2DerivedStackSourceId({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx',
      groupKey: 'auvik|customer||site-b|stack-01',
    })

    expect(first).not.toBe(moved)
  })
})
