import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  getQa: vi.fn(),
  resolve: vi.fn(),
  identity: vi.fn(),
  name: vi.fn(),
}))

vi.mock('@/lib/importer-v2-publication-store', () => ({
  getImporterV2PublicationQa: mocked.getQa,
}))
vi.mock('@/lib/importer-v2-workspace-store', () => ({
  resolveImporterV2PublicationSelection: mocked.resolve,
}))
vi.mock('@/lib/importer-v2-publication-identity-diagnostics', () => ({
  findImporterV2PublicationIdentityConflicts: mocked.identity,
}))
vi.mock('@/lib/importer-v2-publication-name-conflicts', () => ({
  findImporterV2PublicationNameConflicts: mocked.name,
}))

import { POST } from './route'

const context = {
  params: Promise.resolve({ batchId: 'batch-test' }),
}
const url =
  'http://localhost/api/v1/device-import-v2/batches/batch-test/publication/scope'

function request(input: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

describe('selected importer publication scope preview', () => {
  beforeEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset())
    mocked.getQa.mockResolvedValue({
      qaFingerprint: 'qa-1',
      publication: {
        validOnlyCandidateRows: [14, 92, 104, 151],
        allResolvedCandidateRows: [14, 20, 92, 104, 151],
      },
    })
    mocked.resolve.mockResolvedValue([14, 20, 92, 104])
    mocked.identity.mockResolvedValue([
      {
        rowNumber: 92,
        sourceName: 'FW-B',
        hostname: 'fw-b.example',
        selectedCanonicalDeviceId: null,
        sourceIdentifiers: {
          sourceId: 'auvik-fw-b',
          serialNumber: 'SHARED-SERIAL',
          macAddress: null,
        },
        conflicts: [],
        stagedConflicts: [
          {
            rowNumber: 91,
            sourceName: 'FW-A',
            hostname: 'fw-a.example',
            sourceId: 'auvik-fw-a',
            selectedCanonicalDeviceId: null,
            matchingIdentifiers: [
              { field: 'serialNumber', value: 'SHARED-SERIAL' },
            ],
          },
        ],
      },
    ])
    mocked.name.mockResolvedValue([104])
  })

  it('intersects all matching rows with the eligible publication candidates', async () => {
    const response = await POST(
      request({
        mode: 'VALID_ONLY',
        selection: {
          mode: 'QUERY',
          filters: { vendor: 'Fortinet' },
        },
      }),
      context,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        qaFingerprint: 'qa-1',
        mode: 'VALID_ONLY',
        rowNumbers: [14, 92, 104],
        matchedCount: 4,
        eligibleCount: 3,
        skippedCount: 1,
        conflictingRowNumbers: [92, 104],
        safeCandidateRows: [14],
        safeCandidateCount: 1,
        identityConflicts: [
          {
            rowNumber: 92,
            sourceName: 'FW-B',
            hostname: 'fw-b.example',
            sourceId: 'auvik-fw-b',
            selectedCanonicalDeviceId: null,
            canonicalConflicts: [],
            stagedConflicts: [
              {
                rowNumber: 91,
                sourceName: 'FW-A',
                hostname: 'fw-a.example',
                sourceId: 'auvik-fw-a',
                selectedCanonicalDeviceId: null,
                matchingIdentifiers: [
                  { field: 'serialNumber', value: 'SHARED-SERIAL' },
                ],
              },
            ],
          },
        ],
        nameConflictRowNumbers: [104],
      },
    })
    expect(mocked.identity).toHaveBeenCalledWith({
      batchId: 'batch-test',
      rowNumbers: [14, 92, 104],
    })
  })

  it('rejects query keys that could widen scope outside workspace filters', async () => {
    const response = await POST(
      request({
        mode: 'VALID_ONLY',
        selection: {
          mode: 'QUERY',
          filters: { batchId: 'other-batch' },
        },
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(mocked.resolve).not.toHaveBeenCalled()
  })
})
