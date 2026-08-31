import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  customerFindUnique: vi.fn(),
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  customerDelete: vi.fn(),
  contractFindUnique: vi.fn(),
  contractFindMany: vi.fn(),
  deviceFindMany: vi.fn(),
  deviceCount: vi.fn(),
  policyCount: vi.fn(),
  auditCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: {
      findMany: mocks.customerFindMany,
      findUnique: mocks.customerFindUnique,
      create: mocks.customerCreate,
      update: mocks.customerUpdate,
      delete: mocks.customerDelete,
    },
    contractType: {
      findUnique: mocks.contractFindUnique,
      findMany: mocks.contractFindMany,
    },
    device: {
      findMany: mocks.deviceFindMany,
      count: mocks.deviceCount,
    },
    firmwarePolicy: { count: mocks.policyCount },
    auditEvent: { count: mocks.auditCount },
  },
}))

import {
  createCustomer,
  CustomerContractError,
  CustomerInUseError,
  deleteCustomer,
  getCustomer,
  updateCustomer,
} from '@/lib/customer-store'

describe('customer persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a manual customer without external identity fields', async () => {
    mocks.customerCreate.mockResolvedValue({ id: 'customer-1' })

    await createCustomer({ name: 'Example Customer', code: 'example' })

    expect(mocks.customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Example Customer',
          code: 'EXAMPLE',
          contractTypeId: null,
          source: 'MANUAL',
          externalProvider: null,
          externalId: null,
          isActive: true,
        },
      }),
    )
  })

  it('rejects a contract type that does not exist', async () => {
    mocks.contractFindUnique.mockResolvedValue(null)

    await expect(createCustomer({ name: 'Customer', contractTypeId: 'missing-contract' })).rejects.toBeInstanceOf(
      CustomerContractError,
    )
    expect(mocks.customerCreate).not.toHaveBeenCalled()
  })

  it('supports partial archive updates without overwriting customer identity', async () => {
    mocks.customerFindUnique.mockResolvedValue({
      id: 'customer-1',
      name: 'Existing Customer',
      code: 'EXISTING',
      contractTypeId: null,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
      isActive: true,
    })
    mocks.customerUpdate.mockResolvedValue({ id: 'customer-1', isActive: false })

    await updateCustomer('customer-1', { isActive: false })

    expect(mocks.customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          name: 'Existing Customer',
          code: 'EXISTING',
          source: 'MANUAL',
          isActive: false,
        }),
      }),
    )
  })

  it('returns real workflow counts without inventing technical compliance state', async () => {
    const now = new Date('2026-08-31T18:00:00Z')
    mocks.customerFindUnique.mockResolvedValue({
      id: 'customer-1',
      name: 'Customer',
      code: null,
      contractTypeId: null,
      contractType: null,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
      lastSynchronizedAt: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      _count: { devices: 4 },
    })
    mocks.deviceFindMany.mockResolvedValue([
      { lifecycle: { state: 'PLANNED' } },
      { lifecycle: { state: 'DONE' } },
      { lifecycle: { state: 'DONE' } },
      { lifecycle: null },
    ])

    const result = await getCustomer('customer-1')

    expect(result.workflowCounts).toEqual({ planned: 1, ignored: 0, customerDeclined: 0, done: 2 })
    expect(result.desiredStateSummary).toEqual({ available: false, current: null, actionRequired: null })
  })

  it('blocks permanent deletion when customer history is referenced', async () => {
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1', name: 'Customer' })
    mocks.deviceCount.mockResolvedValue(1)
    mocks.policyCount.mockResolvedValue(0)
    mocks.auditCount.mockResolvedValue(0)

    await expect(deleteCustomer('customer-1')).rejects.toBeInstanceOf(CustomerInUseError)
    expect(mocks.customerDelete).not.toHaveBeenCalled()
  })
})
