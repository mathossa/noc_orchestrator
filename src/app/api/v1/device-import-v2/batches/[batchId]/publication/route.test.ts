import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  getQa: vi.fn(),
  resolve: vi.fn(),
  identity: vi.fn(),
  name: vi.fn(),
  publish: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocked.getSession } },
}))
vi.mock('@/lib/importer-v2-publication-store', () => ({
  getImporterV2PublicationQa: mocked.getQa,
  publishImporterV2Batch: mocked.publish,
  ImporterV2PublicationConflictError: class ImporterV2PublicationConflictError extends Error {},
  ImporterV2PublicationValidationError: class ImporterV2PublicationValidationError extends Error {},
}))
vi.mock('@/lib/importer-v2-workspace-store', () => ({
  resolveImporterV2PublicationSelection: mocked.resolve,
}))
vi.mock('@/lib/importer-v2-publication-identity-diagnostics', () => ({
  findImporterV2PublicationIdentityConflicts: mocked.identity,
  formatImporterV2IdentityConflictMessage: () => 'Shared serial is ambiguous.',
}))
vi.mock('@/lib/importer-v2-publication-name-conflicts', () => ({
  findImporterV2PublicationNameConflicts: mocked.name,
}))

import { POST } from './route'

const context = { params: Promise.resolve({ batchId: 'batch-test' }) }
const url = 'http://localhost/api/v1/device-import-v2/batches/batch-test/publication'

function request(input: Record<string, unknown>) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input) })
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'VALID_ONLY',
    qaFingerprint: 'snapshot-1',
    idempotencyKey: 'request-1',
    approvedProposalKeys: [],
    selection: { mode: 'QUERY', filters: { vendor: 'Fortinet' } },
    expectedCandidateRows: [11, 50],
    skipConflicts: true,
    ...overrides,
  }
}

describe('publication with deferred identity conflicts', () => {
  beforeEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset())
    mocked.getQa.mockResolvedValue({
      qaFingerprint: 'snapshot-1',
      publication: {
        validOnlyCandidateRows: [11, 20, 21, 50, 100],
        allResolvedCandidateRows: [11, 20, 21, 50, 100],
      },
    })
    mocked.resolve.mockResolvedValue([11, 20, 21, 50])
    mocked.identity.mockResolvedValue([{ rowNumber: 20 }, { rowNumber: 21 }])
    mocked.name.mockResolvedValue([])
    mocked.getSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mocked.publish.mockResolvedValue({ publishedRows: [{ rowNumber: 11 }, { rowNumber: 50 }] })
  })

  it('publishes only collision-free rows and leaves both ambiguous HA sources staged', async () => {
    const response = await POST(request(body()), context)
    expect(response.status).toBe(200)
    expect(mocked.publish).toHaveBeenCalledOnce()
    expect(mocked.publish).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'batch-test',
      rowNumbers: [11, 50],
      qaFingerprint: 'snapshot-1',
    }))
  })

  it('does not silently ignore duplicate HA identities without explicit opt-in', async () => {
    const response = await POST(request(body({ skipConflicts: false,
      expectedCandidateRows: [11, 20, 21, 50] })), context)
    expect(response.status).toBe(400)
    expect(mocked.publish).not.toHaveBeenCalled()
  })

  it('rejects changes to the exact reviewed safe set after preview', async () => {
    const response = await POST(request(body({
      expectedCandidateRows: [11, 20, 50],
    })), context)
    expect(response.status).toBe(409)
    expect(mocked.publish).not.toHaveBeenCalled()
  })

  it('requires an explicit filter or row selection when deferring conflicts', async () => {
    const input = body()
    delete (input as { selection?: unknown }).selection
    const response = await POST(request(input), context)
    expect(response.status).toBe(400)
    expect(mocked.publish).not.toHaveBeenCalled()
  })
})
