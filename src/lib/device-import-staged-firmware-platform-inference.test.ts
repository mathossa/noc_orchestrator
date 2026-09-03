import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { builtInPreferredModelPlatform } from '@/lib/device-import-staged-firmware-assist'

describe('staged firmware built-in platform inference', () => {
  it.each([
    ['Cisco C9200L-24P-4G', 'IOS XE'],
    ['Cisco C9200L-24P-4X', 'IOS XE'],
    ['Cisco C9300-24P', 'IOS XE'],
    ['Cisco C9300-48P', 'IOS XE'],
    ['Cisco C9300CX-8P-2X2G', 'IOS XE'],
    ['Cisco C9120AXI-E', 'IOS XE'],
    ['Cisco C9120AXE-E', 'IOS XE'],
    ['Cisco WS-C2960X-24PS-L', 'IOS'],
  ])('infers %s as %s', (model, expectedPlatform) => {
    expect(builtInPreferredModelPlatform(model)).toBe(expectedPlatform)
  })

  it('does not guess for an unknown model', () => {
    expect(builtInPreferredModelPlatform('Cisco Mystery-123')).toBe('')
  })
})
