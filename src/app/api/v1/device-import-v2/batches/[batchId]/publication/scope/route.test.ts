import { beforeEach, describe, expect, it, vi } from 'vitest'

const qa = vi.hoisted(() => ({
  get: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@/lib/importer-v2-publication-store', () => ({
  getImporterV2PublicationQa: qa.get,
}))
vi.mock('@/lib/importer-v2-workspace-store', () => ({
  resolveImporterV2PublicationSelection: qa.resolve,
}))

import { POST } from './route'

const context = { params: Promise.resolve({ batchId: 'batch-1' }) }

describe('scoped importer publication preview', () => {
  beforeEach(() => {
    qa.get.mockReset()
    qa.resolve.mockReset()
    qa.get.mockResolvedValue({
      qaFingerprint: 'qa-stable',
      publication: {
        validOnlyCandidateRows: [14, 92, 104, 151],
        allResolvedCandidateRows: [14, 20, 92, 104, 151],
      },
    })
  })

  it('excludes unrelated conflict and review rows from filtered publication', async () => {
    qa.resolve.mockResolvedValue([92, 104, 999])
    const response = await POST(new Request('http://localhost/api/v1/device-import-v2/batches/batch-1/publication/scope', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'VALID_ONLY', selection: { mode: 'QUERY', filters: { vendor: 'Fortinet' } },
      }),
    }), context)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      qaFingerprint: 'qa-stable',
      rowNumbers: [92, 104], matchedCount: 3,
      eligibleCount: 2, skippedCount: 1,
    })
    expect(qa.resolve).toHaveBeenCalledWith({
      batchId: 'batch-1',
      selection: { mode: 'QUERY', filters: { vendor: 'Fortinet' } },
    })
  })

  it('rejects filters that could expand scope outside the allowed server-side query', async () => {
    const response = await POST(new Request('http://localhost/api/v1/device-import-v2/batches/batch-1/publication/scope', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'VALID_ONLY', selection: { mode: 'QUERY', filters: { batchId: 'other' } },
      }),
    }), context)
    expect(response.status).toBe(400)
    expect(qa.resolve).not.toHaveBeenCalled()
  })
})
