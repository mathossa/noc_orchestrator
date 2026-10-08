import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  releaseFindUnique: vi.fn(),
  documentationCreate: vi.fn(),
  documentationFindFirst: vi.fn(),
  documentationUpdate: vi.fn(),
  documentationDelete: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    firmwareRelease: { findUnique: mocks.releaseFindUnique },
    firmwareReleaseDocument: {
      create: mocks.documentationCreate,
      findFirst: mocks.documentationFindFirst,
      update: mocks.documentationUpdate,
      delete: mocks.documentationDelete,
    },
  },
}))

import {
  createReleaseDocumentation,
  deleteReleaseDocumentation,
  FirmwareDocumentationError,
  listReleaseDocumentation,
  updateReleaseDocumentation,
} from './firmware-release-documentation-store'

const row = {
  id: 'doc-1',
  firmwareReleaseId: 'release-1',
  type: 'UPGRADE_GUIDE',
  title: 'Implementation guide',
  url: 'https://example.com/guide',
  source: 'Internal NOC',
  notes: null,
  match: 'EXACT_VERSION',
  verifiedAt: null,
}
const release = {
  id: 'release-1', version: '7.6.4', platform: 'FortiOS',
  vendor: { code: 'FORTINET', name: 'Fortinet' },
  releaseNotesUrl: 'https://example.com/old-notes',
  documentation: [row],
}

describe('release documentation store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.releaseFindUnique.mockResolvedValue(release)
    mocks.documentationCreate.mockResolvedValue(row)
    mocks.documentationFindFirst.mockResolvedValue(row)
    mocks.documentationUpdate.mockResolvedValue(row)
    mocks.documentationDelete.mockResolvedValue(row)
  })

  it('resolves manual, legacy and auto-suggested documentation for one canonical release', async () => {
    const result = await listReleaseDocumentation('release-1')
    expect(result.release).toMatchObject({ id: 'release-1', version: '7.6.4' })
    expect(result.data.map((document) => document.origin)).toEqual([
      'MANUAL', 'LEGACY', 'AUTO_SUGGESTED',
    ])
    expect(result.data.at(-1)).toMatchObject({
      type: 'RELEASE_NOTES', match: 'EXACT_VERSION', verifiedAt: null,
    })
    expect(mocks.releaseFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'release-1' },
      select: expect.objectContaining({ documentation: expect.any(Object) }),
    }))
  })

  it('never invents a document for an unknown canonical release', async () => {
    mocks.releaseFindUnique.mockResolvedValue(null)
    await expect(listReleaseDocumentation('missing')).rejects.toMatchObject({ status: 404 })
  })

  it('validates URL schemes and documents without leaking credentials', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://example.com', 'https://secret:token@example.com/a']) {
      await expect(createReleaseDocumentation('release-1', {
        type: 'RELEASE_NOTES', title: 'Test', source: 'Vendor', url,
      })).rejects.toBeInstanceOf(FirmwareDocumentationError)
    }
    expect(mocks.documentationCreate).not.toHaveBeenCalled()
  })

  it('creates release-owned typed documents, not duplicate device-owned links', async () => {
    const result = await createReleaseDocumentation('release-1', {
      type: 'UPGRADE_GUIDE', title: ' Implementation guide ',
      url: 'https://example.com/guide', source: ' Internal NOC ',
      match: 'EXACT_VERSION',
    })
    expect(result.id).toBe('doc-1')
    expect(mocks.documentationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmwareReleaseId: 'release-1', type: 'UPGRADE_GUIDE',
        title: 'Implementation guide', source: 'Internal NOC',
      }),
    })
  })

  it('cannot edit documentation through a different release ID', async () => {
    mocks.documentationFindFirst.mockResolvedValue(null)
    await expect(updateReleaseDocumentation('other-release', 'doc-1', {
      title: 'Wrong',
    })).rejects.toMatchObject({ status: 404 })
    expect(mocks.documentationUpdate).not.toHaveBeenCalled()
  })

  it('cannot delete documentation through a different release ID', async () => {
    mocks.documentationFindFirst.mockResolvedValue(null)
    await expect(deleteReleaseDocumentation('other-release', 'doc-1'))
      .rejects.toMatchObject({ status: 404 })
    expect(mocks.documentationDelete).not.toHaveBeenCalled()
  })

  it('resets verification when a maintained reference changes', async () => {
    await updateReleaseDocumentation('release-1', 'doc-1', {
      title: 'Updated guide',
    })
    expect(mocks.documentationUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { title: 'Updated guide', verifiedAt: null },
    })
  })

  it('only removes the selected release-owned document', async () => {
    await deleteReleaseDocumentation('release-1', 'doc-1')
    expect(mocks.documentationFindFirst).toHaveBeenCalledWith({
      where: { id: 'doc-1', firmwareReleaseId: 'release-1' },
    })
    expect(mocks.documentationDelete).toHaveBeenCalledWith({ where: { id: 'doc-1' } })
  })

  it('reports a duplicate URL conflict, without altering another release', async () => {
    mocks.documentationCreate.mockRejectedValue({ code: 'P2002' })
    await expect(createReleaseDocumentation('release-1', {
      type: 'RELEASE_NOTES', title: 'Notes', url: 'https://example.com/notes',
      source: 'Vendor',
    })).rejects.toMatchObject({ status: 409 })
  })
})
