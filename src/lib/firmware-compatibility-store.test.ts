import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelFindUnique: vi.fn(),
  modelFindMany: vi.fn(),
  familyFindUnique: vi.fn(),
  vendorFindUnique: vi.fn(),
  trainFindUnique: vi.fn(),
  releaseFindUnique: vi.fn(),
  releaseFindMany: vi.fn(),
  ruleFindMany: vi.fn(),
  ruleCreate: vi.fn(),
  ruleFindUnique: vi.fn(),
  ruleUpdate: vi.fn(),
  overrideFindMany: vi.fn(),
  overrideFindFirst: vi.fn(),
  overrideUpdateMany: vi.fn(),
  overrideCreate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: { findUnique: mocks.modelFindUnique, findMany: mocks.modelFindMany },
    deviceModelFamily: { findUnique: mocks.familyFindUnique },
    vendor: { findUnique: mocks.vendorFindUnique },
    firmwareTrain: { findUnique: mocks.trainFindUnique },
    firmwareRelease: { findUnique: mocks.releaseFindUnique, findMany: mocks.releaseFindMany },
    firmwareCompatibilityRule: {
      findMany: mocks.ruleFindMany,
      create: mocks.ruleCreate,
      findUnique: mocks.ruleFindUnique,
      update: mocks.ruleUpdate,
    },
    firmwareCompatibilityOverride: {
      findMany: mocks.overrideFindMany,
      findFirst: mocks.overrideFindFirst,
      updateMany: mocks.overrideUpdateMany,
      create: mocks.overrideCreate,
    },
    auditEvent: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}))

import {
  clearFirmwareCompatibilityOverride,
  createFirmwareCompatibilityRule,
  evaluateModelFirmwareCompatibility,
  previewFamilyFirmwareCompatibility,
  resolveFirmwareImageForModel,
  setFirmwareCompatibilityOverride,
} from '@/lib/firmware-compatibility-store'

const model = { id: 'model-1', vendorId: 'vendor-1', familyId: 'family-1', model: 'AP-515', isActive: true }
const releaseYa = {
  id: 'release-ya',
  vendorId: 'vendor-1',
  platform: 'AOS-S',
  firmwareTrainId: 'train-1',
  logicalVersion: '16.11.0014',
  version: 'YA.16.11.0014',
  imageCode: 'YA',
  variant: null,
  isActive: true,
}
const releaseYb = { ...releaseYa, id: 'release-yb', version: 'YB.16.11.0014', imageCode: 'YB' }
const familyAllow = {
  id: 'rule-family-ya',
  vendorId: 'vendor-1',
  deviceModelFamilyId: 'family-1',
  deviceModelId: null,
  platform: 'AOS-S',
  firmwareTrainId: null,
  logicalVersion: null,
  firmwareReleaseId: null,
  imageCode: 'YA',
  decision: 'ALLOW',
  sourceType: 'CATALOG',
  explanation: 'Family uses YA images.',
  isActive: true,
  validFrom: null,
  validUntil: null,
}

function compatibleRuleForImage(imageCode: string, decision: 'ALLOW' | 'DENY' = 'ALLOW') {
  return { ...familyAllow, id: `rule-${imageCode}-${decision}`, imageCode, decision, explanation: `${imageCode} ${decision}` }
}

describe('firmware compatibility persistence services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modelFindUnique.mockResolvedValue(model)
    mocks.familyFindUnique.mockResolvedValue({ id: 'family-1', vendorId: 'vendor-1', name: 'AP500' })
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1' })
    mocks.trainFindUnique.mockResolvedValue({ id: 'train-1', vendorId: 'vendor-1', platform: 'AOS-S' })
    mocks.releaseFindUnique.mockResolvedValue(releaseYa)
    mocks.releaseFindMany.mockResolvedValue([releaseYa, releaseYb])
    mocks.ruleFindMany.mockResolvedValue([compatibleRuleForImage('YA'), compatibleRuleForImage('YB', 'DENY')])
    mocks.overrideFindMany.mockResolvedValue([])
    mocks.overrideFindFirst.mockResolvedValue(null)
    mocks.overrideUpdateMany.mockResolvedValue({ count: 0 })
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwareCompatibilityOverride: {
        updateMany: mocks.overrideUpdateMany,
        create: mocks.overrideCreate,
      },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('evaluates model compatibility with family rules and source provenance', async () => {
    const result = await evaluateModelFirmwareCompatibility('model-1', 'release-ya')
    expect(result).toMatchObject({
      status: 'COMPATIBLE',
      provenance: { kind: 'FAMILY_RULE', id: 'rule-YA-ALLOW', inherited: true },
    })
  })

  it('resolves the exact compatible image among sibling canonical releases', async () => {
    const result = await resolveFirmwareImageForModel('model-1', 'release-ya')
    expect(result).toMatchObject({ status: 'RESOLVED', release: { id: 'release-ya', imageCode: 'YA' } })
  })

  it('creates compatibility rules only after validating vendor/subject/target references', async () => {
    mocks.ruleCreate.mockResolvedValue({ id: 'new-rule' })
    await expect(createFirmwareCompatibilityRule({
      vendorId: 'vendor-1',
      deviceModelFamilyId: 'family-1',
      platform: 'AOS-S',
      firmwareTrainId: 'train-1',
      imageCode: 'YA',
      decision: 'ALLOW',
      sourceType: 'CONFIGURED_RULE',
      explanation: 'Vendor matrix states YA support.',
    })).resolves.toEqual({ id: 'new-rule' })
    expect(mocks.ruleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deviceModelFamilyId: 'family-1', deviceModelId: null, imageCode: 'YA' }),
    }))
  })

  it('versions a manual override, deactivates the prior one, and audits the change', async () => {
    const previous = {
      id: 'override-1', deviceModelId: 'model-1', firmwareReleaseId: 'release-ya', decision: 'DENY',
      reason: 'Old interpretation.', version: 1, isActive: true, createdAt: new Date('2026-09-04T10:00:00Z'), createdByUserId: 'user-old',
    }
    const created = {
      ...previous,
      id: 'override-2',
      decision: 'ALLOW',
      reason: 'Vendor bulletin confirms support.',
      version: 2,
      createdByUserId: 'user-1',
    }
    mocks.overrideFindFirst.mockResolvedValue(previous)
    mocks.overrideCreate.mockResolvedValue(created)

    const result = await setFirmwareCompatibilityOverride({
      deviceModelId: 'model-1', firmwareReleaseId: 'release-ya', decision: 'ALLOW', reason: 'Vendor bulletin confirms support.',
    }, 'user-1')

    expect(result).toEqual(created)
    expect(mocks.overrideUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }))
    expect(mocks.overrideCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2, decision: 'ALLOW', createdByUserId: 'user-1' }) }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FIRMWARE_COMPATIBILITY_OVERRIDE_CHANGED',
        before: expect.objectContaining({ decision: 'DENY', version: 1 }),
        after: expect.objectContaining({ decision: 'ALLOW', version: 2 }),
        metadata: { compatibilitySource: 'MANUAL_OVERRIDE' },
      }),
    }))
  })

  it('clears an override without rewriting compatibility rules and audits the removal', async () => {
    const previous = {
      id: 'override-2', deviceModelId: 'model-1', firmwareReleaseId: 'release-ya', decision: 'ALLOW',
      reason: 'Vendor bulletin confirms support.', version: 2, isActive: true, createdAt: new Date(), createdByUserId: 'user-1',
    }
    mocks.overrideFindFirst.mockResolvedValue(previous)
    await expect(clearFirmwareCompatibilityOverride('model-1', 'release-ya', 'user-1')).resolves.toEqual({ cleared: true })
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FIRMWARE_COMPATIBILITY_OVERRIDE_CLEARED' }) }))
  })

  it('groups family impact and blocks silent application when a child is unresolved', async () => {
    mocks.modelFindMany.mockResolvedValue([
      { id: 'model-1', model: 'AP-515' },
      { id: 'model-2', model: 'AP-505' },
    ])
    mocks.modelFindUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({
      ...model,
      id: where.id,
      model: where.id === 'model-1' ? 'AP-515' : 'AP-505',
    }))
    mocks.ruleFindMany.mockImplementation(({ where }: { where: { OR: Array<Record<string, string>> } }) => {
      const modelTerm = where.OR.find((term) => 'deviceModelId' in term) as { deviceModelId?: string } | undefined
      return Promise.resolve(modelTerm?.deviceModelId === 'model-2' ? [] : [compatibleRuleForImage('YA'), compatibleRuleForImage('YB', 'DENY')])
    })

    const impact = await previewFamilyFirmwareCompatibility('family-1', 'release-ya')
    expect(impact.canApply).toBe(false)
    expect(impact.compatible.map((item) => item.deviceModelId)).toEqual(['model-1'])
    expect(impact.unknown.map((item) => item.deviceModelId)).toEqual(['model-2'])
  })
})
