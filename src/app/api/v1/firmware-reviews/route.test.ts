import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createFirmwareReviewCycle: vi.fn(),
  listFirmwareReviewCycles: vi.fn(),
  getFirmwareReviewCycle: vi.fn(),
  generateFirmwareReviewReport: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}))

vi.mock('@/lib/firmware-review-store', () => {
  class FirmwareReviewError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message)
      this.name = 'FirmwareReviewError'
    }
  }
  return {
    FirmwareReviewError,
    createFirmwareReviewCycle: mocks.createFirmwareReviewCycle,
    listFirmwareReviewCycles: mocks.listFirmwareReviewCycles,
    getFirmwareReviewCycle: mocks.getFirmwareReviewCycle,
    generateFirmwareReviewReport: mocks.generateFirmwareReviewReport,
  }
})

import {
  GET as listReviews,
  POST as createReview,
} from '@/app/api/v1/firmware-reviews/route'
import { GET as getReview } from '@/app/api/v1/firmware-reviews/[id]/route'
import { POST as generateReport } from '@/app/api/v1/firmware-reviews/[id]/reports/route'

describe('firmware review routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'session-user', role: 'admin' },
    })
  })

  it('lists review cycles with customer and state filters', async () => {
    mocks.listFirmwareReviewCycles.mockResolvedValue([])

    const response = await listReviews(
      new Request(
        'http://localhost/api/v1/firmware-reviews?customerId=customer-1&state=ready',
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.listFirmwareReviewCycles).toHaveBeenCalledWith({
      customerId: 'customer-1',
      state: 'READY',
    })
  })

  it('creates a review cycle using the authenticated actor', async () => {
    mocks.createFirmwareReviewCycle.mockResolvedValue({ id: 'review-1' })

    const response = await createReview(
      new Request('http://localhost/api/v1/firmware-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: 'customer-1',
          reviewerUserId: 'client-supplied-user',
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.createFirmwareReviewCycle).toHaveBeenCalledWith(
      {
        customerId: 'customer-1',
        reviewerUserId: 'client-supplied-user',
      },
      'session-user',
    )
  })

  it('returns one cycle with its immutable report versions', async () => {
    mocks.getFirmwareReviewCycle.mockResolvedValue({
      id: 'review-1',
      reports: [{ id: 'report-2', version: 2 }],
    })

    const response = await getReview(
      new Request('http://localhost/api/v1/firmware-reviews/review-1'),
      { params: Promise.resolve({ id: 'review-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.getFirmwareReviewCycle).toHaveBeenCalledWith('review-1')
    expect((await response.json()).data.reports[0].version).toBe(2)
  })

  it('generates a new report version using the authenticated actor', async () => {
    mocks.generateFirmwareReviewReport.mockResolvedValue({
      id: 'report-1',
      version: 1,
    })

    const response = await generateReport(
      new Request(
        'http://localhost/api/v1/firmware-reviews/review-1/reports',
        { method: 'POST' },
      ),
      { params: Promise.resolve({ id: 'review-1' }) },
    )

    expect(response.status).toBe(201)
    expect(mocks.generateFirmwareReviewReport).toHaveBeenCalledWith(
      'review-1',
      'session-user',
    )
  })
})
