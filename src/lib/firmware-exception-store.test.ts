import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveFirmwareCompliance } from './firmware-compliance'
import { input, release } from './test-fixtures/firmware-compliance'
const mocks = vi.hoisted(() => ({
  device: vi.fn(),
  devices: vi.fn(),
  reason: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  compliance: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('@/lib/firmware-compliance-store', () => ({
  resolveFirmwareComplianceBatch: mocks.compliance,
}))
import {
  createFirmwareException,
  previewFirmwareException,
  supersedeFirmwareException,
} from './firmware-exception-store'
const tx = {
  device: { findUnique: mocks.device, findMany: mocks.devices },
  firmwareExceptionReason: { findUnique: mocks.reason },
  firmwareException: {
    create: mocks.create,
    findUnique: mocks.find,
    update: mocks.update,
  },
  auditEvent: { create: mocks.audit },
}
const raw = {
  scope: 'DEVICE',
  scopeId: 'device',
  subject: 'ALL_MAINTENANCE',
  reasonCode: 'CUSTOMER_DECLINED',
  duration: 'POLICY_CHANGE',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(async (fn) => fn(tx))
  mocks.device.mockResolvedValue({ name: 'Test device' })
  mocks.devices.mockResolvedValue([
    {
      id: 'device',
      name: 'Test device',
      customerId: 'customer',
      siteId: null,
      deviceModelId: 'model',
      deviceModel: { familyId: null },
    },
  ])
  mocks.reason.mockResolvedValue({ code: 'CUSTOMER_DECLINED', isActive: true })
  mocks.compliance.mockResolvedValue(
    new Map([['device', resolveFirmwareCompliance(input('17.9.4'))]]),
  )
  mocks.create.mockImplementation(async ({ data }) => ({
    id: 'exception',
    ...data,
  }))
  mocks.audit.mockResolvedValue({ id: 'audit' })
})
describe('exception preview and persistence', () => {
  it('previews without writes and uses the transaction client for policy resolution', async () => {
    const preview = await previewFirmwareException(raw)
    expect(preview.affectedCount).toBe(1)
    expect(preview.affectedDevices).toEqual([
      { id: 'device', name: 'Test device' },
    ])
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.compliance.mock.calls[0][2]).toBe(tx)
  })
  it('saves exactly the confirmed coverage and audit together in a serializable transaction', async () => {
    const p = await previewFirmwareException(raw)
    const record = await createFirmwareException(raw, 'actor', p.token)
    expect(record.actorUserId).toBe('actor')
    expect(record.policySnapshots).toEqual(p.policySnapshots)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityId: 'exception',
          actorUserId: 'actor',
        }),
      }),
    )
    expect(mocks.transaction.mock.lastCall?.[1]).toMatchObject({
      isolationLevel: 'Serializable',
    })
  })
  it('rejects stale policy/target previews before making writes', async () => {
    const p = await previewFirmwareException(raw)
    const t = resolveFirmwareCompliance(input('17.9.4'))
    t.resolvedTarget = release('17.15.6')
    mocks.compliance.mockResolvedValue(new Map([['device', t]]))
    await expect(
      createFirmwareException(raw, 'actor', p.token),
    ).rejects.toThrow('Preview')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects changed input and missing confirmation', async () => {
    const p = await previewFirmwareException(raw)
    await expect(
      createFirmwareException({ ...raw, notes: 'different' }, 'actor', p.token),
    ).rejects.toThrow('Preview')
    await expect(createFirmwareException(raw, 'actor', '')).rejects.toThrow(
      'Preview',
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not swallow an audit failure inside the creation transaction', async () => {
    const p = await previewFirmwareException(raw)
    mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(
      createFirmwareException(raw, 'actor', p.token),
    ).rejects.toThrow('audit unavailable')
  })
  it('retains ended records and does not duplicate end audits on retry', async () => {
    mocks.find.mockResolvedValue({ id: 'exception', supersededAt: new Date() })
    await supersedeFirmwareException('exception', 'actor')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
