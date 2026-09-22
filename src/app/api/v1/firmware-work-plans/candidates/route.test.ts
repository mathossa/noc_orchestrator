import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listCandidates: vi.fn(),
}))

vi.mock('@/lib/firmware-work-plan-candidates', () => {
  class FirmwareWorkPlanCandidateError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message)
      this.name = 'FirmwareWorkPlanCandidateError'
    }
  }
  return {
    FirmwareWorkPlanCandidateError,
    listFirmwareWorkPlanCandidates: mocks.listCandidates,
  }
})

import { POST } from './route'
import { FirmwareWorkPlanCandidateError } from '@/lib/firmware-work-plan-candidates'

describe('firmware work plan candidate route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes site/type scope to the narrow candidate resolver', async () => {
    mocks.listCandidates.mockResolvedValue([
      { id: 'device-1' },
      { id: 'device-2' },
    ])

    const response = await POST(
      new Request(
        'http://localhost/api/v1/firmware-work-plans/candidates',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteIds: ['site-a', 'site-b'],
            deviceTypeIds: ['type-switch', 'type-ap'],
          }),
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.listCandidates).toHaveBeenCalledWith({
      siteIds: ['site-a', 'site-b'],
      deviceTypeIds: ['type-switch', 'type-ap'],
    })
    expect((await response.json()).data).toHaveLength(2)
  })

  it('returns a scoped validation error without falling through to a 500', async () => {
    mocks.listCandidates.mockRejectedValue(
      new FirmwareWorkPlanCandidateError(
        'siteIds must contain at least one identifier.',
      ),
    )

    const response = await POST(
      new Request(
        'http://localhost/api/v1/firmware-work-plans/candidates',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteIds: [],
            deviceTypeIds: ['type-switch'],
          }),
        },
      ),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_SCOPE')
  })
})
