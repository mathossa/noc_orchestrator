import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        device: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
        auditEvent: { create: mocks.audit },
      }),
  },
}))
vi.mock('@/lib/device-store', () => ({
  DeviceConflictError: class extends Error {},
  DeviceNotFoundError: class extends Error {},
}))
import { annotateDevice, parseDeviceAnnotation } from './device-annotations'

describe('device notes and issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findUnique.mockResolvedValue({
      id: 'd',
      customerId: 'c',
      notes: 'Existing note',
      issueReason: null,
      issueFlaggedAt: null,
      updatedAt: new Date('2026-09-01'),
    })
    mocks.updateMany.mockResolvedValue({ count: 1 })
  })
  it('requires a short description and a known action', () => {
    for (const input of [
      { action: 'FLAG', text: ' ' },
      { action: 'ADD_NOTE', text: 'x'.repeat(1001) },
      { action: 'PLANNED' },
    ])
      expect(() => parseDeviceAnnotation(input)).toThrow()
  })
  it('appends notes without overwriting existing notes or touching firmware/planning fields', async () => {
    await annotateDevice(
      'd',
      {
        action: 'ADD_NOTE',
        text: 'New note',
        currentFirmwareReleaseId: 'injected',
        lifecycle: 'DONE',
      },
      'actor',
    )
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'd', updatedAt: new Date('2026-09-01') },
      data: { notes: 'Existing note\n\nNew note' },
    })
    expect(mocks.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'actor',
        action: 'DEVICE_NOTE_ADDED',
        before: { notes: 'Existing note' },
        metadata: { note: 'New note' },
      }),
    })
  })
  it('flags an issue independently and records its actor and reason', async () => {
    await annotateDevice(
      'd',
      { action: 'FLAG', text: 'Cannot reach management' },
      'actor',
    )
    expect(mocks.updateMany.mock.calls[0][0].data).toEqual({
      issueReason: 'Cannot reach management',
      issueFlaggedAt: expect.any(Date),
    })
    expect(mocks.audit.mock.calls[0][0].data.action).toBe(
      'DEVICE_ISSUE_FLAGGED',
    )
  })
  it('resolves the flag while retaining the original reason in history', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'd',
      customerId: 'c',
      notes: null,
      issueReason: 'Investigate',
      issueFlaggedAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-01'),
    })
    await annotateDevice('d', { action: 'RESOLVE_FLAG' })
    expect(mocks.updateMany.mock.calls[0][0].data).toEqual({
      issueReason: null,
      issueFlaggedAt: null,
    })
    expect(mocks.audit.mock.calls[0][0].data).toMatchObject({
      action: 'DEVICE_ISSUE_RESOLVED',
      before: { issueReason: 'Investigate' },
    })
  })
  it('rejects concurrent changes before writing history', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      annotateDevice('d', { action: 'FLAG', text: 'Issue' }),
    ).rejects.toThrow('changed')
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('does not silently replace another open issue', async () => {
    mocks.findUnique.mockResolvedValue({ issueReason: 'Existing issue' })
    await expect(
      annotateDevice('d', { action: 'FLAG', text: 'Other issue' }),
    ).rejects.toThrow('already has an open issue')
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it('rejects missing devices and notes that exceed the inventory limit', async () => {
    mocks.findUnique.mockResolvedValue(null)
    await expect(
      annotateDevice('missing', { action: 'FLAG', text: 'Issue' }),
    ).rejects.toThrow()
    mocks.findUnique.mockResolvedValue({ notes: 'x'.repeat(4999) })
    await expect(
      annotateDevice('d', { action: 'ADD_NOTE', text: 'more' }),
    ).rejects.toThrow('5000')
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
