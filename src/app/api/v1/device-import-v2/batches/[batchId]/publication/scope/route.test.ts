import { beforeEach, describe, expect, it, vi } from 'vitest'

const qa = vi.hoisted(() => ({
  get: vi.fn(),
  resolve: vi.fn(),
  identity: vi.fn(),
  name: vi.fn(),
}))

vi.mock('@/lib/importer-v2-publication-store', () => ({
  getImporterV2PublicationQa: qa.get,
}))
vi.mock('@/lib/api-admin', () => ({
  requireAdminRequest: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'admin' }),
  AdminAccessError: class AdminAccessError extends Error {
    status = 401
  },
}))

vi.mock('@/lib/importer-v2-workspace-store', () => ({
  resolveImporterV2PublicationSelection: qa.resolve,
}))
vi.mock('@/lib/importer-v2-publication-identity-diagnostics', () => ({
  findImporterV2PublicationIdentityConflicts: qa.identity,
}))
vi.mock('@/lib/importer-v2-publication-name-conflicts', () => ({
  findImporterV2PublicationNameConflicts: qa.name,
}))

import { POST } from './route'

const context = { params: Promise.resolve({ batchId: 'batch-1' }) }

describe('scoped importer publication preview', () => {
  beforeEach(() => {
    qa.get.mockReset()
    qa.resolve.mockReset()
    qa.identity.mockReset()
    qa.name.mockReset()
    qa.identity.mockResolvedValue([])
    qa.name.mockResolvedValue([])
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
      eligibleCount: 2, skippedCount: 1, safeCandidateCount: 2, conflictingRowNumbers: [],
    })
    expect(qa.resolve).toHaveBeenCalledWith({
      batchId: 'batch-1',
      selection: { mode: 'QUERY', filters: { vendor: 'Fortinet' } },
    })
  })

  it('reports both HA siblings and canonical name conflicts without applying any changes', async () => {
    qa.resolve.mockResolvedValue([92, 104, 151, 200])
    qa.identity.mockResolvedValue([{ rowNumber: 92 }, { rowNumber: 104 }])
    qa.name.mockResolvedValue([151])
    const response = await POST(new Request('http://localhost/api/v1/device-import-v2/batches/batch-1/publication/scope', {
      method: 'POST',
      body: JSON.stringify({ mode: 'VALID_ONLY', selection: { mode: 'QUERY', filters: { vendor: 'Fortinet' } } }),
    }), context)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      matchedCount: 4, eligibleCount: 3, conflictingRowNumbers: [92, 104, 151],
      safeCandidateCount: 0,
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
