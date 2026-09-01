import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  vendorFindUnique: vi.fn(),
  deviceTypeFindUnique: vi.fn(),
  modelFindUnique: vi.fn(),
  contractFindUnique: vi.fn(),
  releaseFindUnique: vi.fn(),
  profileFindUnique: vi.fn(),
  aliasUpsert: vi.fn(),
  profileAliasUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: { findUnique: mocks.customerFindUnique },
    site: { findUnique: mocks.siteFindUnique },
    vendor: { findUnique: mocks.vendorFindUnique },
    deviceType: { findUnique: mocks.deviceTypeFindUnique },
    deviceModel: { findUnique: mocks.modelFindUnique },
    contractType: { findUnique: mocks.contractFindUnique },
    firmwareRelease: { findUnique: mocks.releaseFindUnique },
    deviceImportProfile: { findUnique: mocks.profileFindUnique },
    importReferenceAlias: { upsert: mocks.aliasUpsert },
    deviceImportProfileAlias: { upsert: mocks.profileAliasUpsert },
  },
}))

import { DeviceImportReferenceError, saveImportReferenceAlias } from '@/lib/device-import-reference-store'

describe('saved XLSX import reference aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.aliasUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'alias-1', ...create }))
    mocks.profileAliasUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'profile-alias-1', ...create }))
    mocks.profileFindUnique.mockResolvedValue({ id: 'profile-auvik', isActive: true })
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

  it('scopes remembered choices to a selected import profile', async () => {
    mocks.deviceTypeFindUnique.mockResolvedValue({ id: 'type-1', name: 'Switches', isActive: true })
    const result = await saveImportReferenceAlias({
      kind: 'DEVICE_TYPE',
      sourceValue: 'Switch',
      targetId: 'type-1',
      profileId: 'profile-auvik',
    })

    expect(result).toMatchObject({ profileId: 'profile-auvik', kind: 'DEVICE_TYPE', targetId: 'type-1' })
    expect(mocks.profileAliasUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ profileId: 'profile-auvik', normalizedSourceValue: 'switch' }),
    }))
    expect(mocks.aliasUpsert).not.toHaveBeenCalled()
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

  it('scopes a site alias to its customer', async () => {
    mocks.siteFindUnique.mockResolvedValue({ id: 'site-1', name: 'Amsterdam', customerId: 'customer-1', isActive: true })
    const result = await saveImportReferenceAlias({
      kind: 'SITE',
      sourceValue: 'Amsterdam HQ',
      contextKey: 'customer-1',
      targetId: 'site-1',
      profileId: 'profile-auvik',
    })

    expect(result).toMatchObject({ kind: 'SITE', contextKey: 'customer-1', targetId: 'site-1' })
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
