import { beforeEach, describe, expect, it, vi } from 'vitest'

// Business-case unit tests exercise handlers without the shared boundary.
// Access-denial behavior is covered independently by api-route-guard.test.ts.
vi.mock('@/lib/api-route-guard', () => ({ withAdmin: <T,>(handler: T): T => handler }))

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
  formatImporterV2IdentityConflictMessage: () =>
    'Selected rows contain a durable identity conflict.',
}))
vi.mock('@/lib/importer-v2-publication-name-conflicts', () => ({
  findImporterV2PublicationNameConflicts: mocked.name,
}))

import { POST } from './route'

const context = {
  params: Promise.resolve({ batchId: 'batch-test' }),
}
const url =
  'http://localhost/api/v1/device-import-v2/batches/batch-test/publication'

function request(input: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'VALID_ONLY',
    qaFingerprint: 'qa-1',
    idempotencyKey: 'request-1',
    approvedProposalKeys: [],
    selection: {
      mode: 'QUERY',
      filters: { vendor: 'Fortinet' },
    },
    expectedCandidateRows: [11, 50],
    ...overrides,
  }
}

describe('selected importer publication', () => {
  beforeEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset())
    mocked.getQa.mockResolvedValue({
      qaFingerprint: 'qa-1',
      publication: {
        validOnlyCandidateRows: [11, 20, 50, 100],
        allResolvedCandidateRows: [11, 20, 50, 100],
      },
    })
    mocked.resolve.mockResolvedValue([11, 50])
    mocked.identity.mockResolvedValue([])
    mocked.name.mockResolvedValue([])
    mocked.getSession.mockResolvedValue({
      user: { id: 'admin-1' },
    })
    mocked.publish.mockResolvedValue({
      publishedRows: [
        { rowNumber: 11 },
        { rowNumber: 50 },
      ],
      remainingIncludedRows: 2,
      batchStatus: 'STAGED',
    })
  })

  it('publishes only the exact server-resolved selected rows', async () => {
    const response = await POST(request(body()), context)

    expect(response.status).toBe(200)
    expect(mocked.identity).toHaveBeenCalledWith({
      batchId: 'batch-test',
      rowNumbers: [11, 50],
    })
    expect(mocked.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 'batch-test',
        mode: 'VALID_ONLY',
        rowNumbers: [11, 50],
        qaFingerprint: 'qa-1',
      }),
    )
  })

  it('publishes the safe subset and leaves selected conflicts staged', async () => {
    mocked.resolve.mockResolvedValue([11, 20, 50])
    mocked.identity.mockResolvedValue([{ rowNumber: 20 }])

    const response = await POST(
      request(
        body({
          skipConflicts: true,
          expectedCandidateRows: [11, 50],
        }),
      ),
      context,
    )

    expect(response.status).toBe(200)
    expect(mocked.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        rowNumbers: [11, 50],
      }),
    )
  })

  it('does not silently skip conflicts unless the engineer opted in', async () => {
    mocked.resolve.mockResolvedValue([11, 20, 50])
    mocked.identity.mockResolvedValue([{ rowNumber: 20 }])

    const response = await POST(
      request(
        body({
          expectedCandidateRows: [11, 20, 50],
        }),
      ),
      context,
    )

    expect(response.status).toBe(400)
    expect(mocked.publish).not.toHaveBeenCalled()
  })

  it('rejects publication when the exact previewed row set changed', async () => {
    mocked.resolve.mockResolvedValue([11, 20, 50])

    const response = await POST(request(body()), context)

    expect(response.status).toBe(409)
    expect(mocked.publish).not.toHaveBeenCalled()
  })

  it('requires the reviewed candidate set for selected publication', async () => {
    const input = body()
    delete (input as { expectedCandidateRows?: unknown })
      .expectedCandidateRows

    const response = await POST(request(input), context)

    expect(response.status).toBe(400)
    expect(mocked.publish).not.toHaveBeenCalled()
  })
})
