import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deviceTypeFindUnique: vi.fn(),
  modelFindUnique: vi.fn(),
  aliasUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceType: { findUnique: mocks.deviceTypeFindUnique },
    deviceModel: { findUnique: mocks.modelFindUnique },
    importReferenceAlias: { upsert: mocks.aliasUpsert },
  },
}))

import { DeviceImportReferenceError, saveImportReferenceAlias } from '@/lib/device-import-reference-store'

describe('saved XLSX import reference aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.aliasUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'alias-1', ...create }))
  })

  it('stores device-type aliases globally using normalized spreadsheet text', async () => {
    mocks.deviceTypeFindUnique.mockResolvedValue({ id: 'type-1', name: 'Switches', isActive: true })
    const result = await saveImportReferenceAlias({
      kind: 'DEVICE_TYPE',
      sourceValue: '  Switch  ',
      targetId: 'type-1',
    })

    expect(result).toMatchObject({ kind: 'DEVICE_TYPE', sourceValue: 'Switch', normalizedSourceValue: 'switch', contextKey: '', targetId: 'type-1' })
    expect(mocks.aliasUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ normalizedSourceValue: 'switch', contextKey: '', targetId: 'type-1' }),
    }))
  })

  it('scopes model aliases to the concrete model vendor', async () => {
    mocks.modelFindUnique.mockResolvedValue({
      id: 'model-1', model: 'FortiGate-100F', vendorId: 'vendor-fortinet', isActive: true,
      vendor: { name: 'Fortinet' },
    })
    const result = await saveImportReferenceAlias({
      kind: 'DEVICE_MODEL',
      sourceValue: 'Fortinet FortiGate-100F',
      contextKey: 'vendor-fortinet',
      targetId: 'model-1',
    })

    expect(result).toMatchObject({ kind: 'DEVICE_MODEL', contextKey: 'vendor-fortinet', targetId: 'model-1' })
  })

  it('rejects remembering a model under another vendor context', async () => {
    mocks.modelFindUnique.mockResolvedValue({
      id: 'model-1', model: 'FortiGate-100F', vendorId: 'vendor-fortinet', isActive: true,
      vendor: { name: 'Fortinet' },
    })

    await expect(saveImportReferenceAlias({
      kind: 'DEVICE_MODEL',
      sourceValue: 'Fortinet FortiGate-100F',
      contextKey: 'vendor-other',
      targetId: 'model-1',
    })).rejects.toBeInstanceOf(DeviceImportReferenceError)
  })
})
