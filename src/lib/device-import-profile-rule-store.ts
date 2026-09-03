import { normalizeImportText } from '@/lib/device-import'
import {
  IMPORT_PREDICTION_FIELDS,
  IMPORT_PREDICTION_OPERATORS,
  type DeviceImportPredictionResult,
} from '@/lib/device-import-profile-predictions'
import { prisma } from '@/lib/prisma'

export class DeviceImportProfileRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportProfileRuleError'
  }
}

function text(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : ''
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

export async function listImportProfileRuleWorkspace(profileId: string) {
  const profile = await prisma.deviceImportProfile.findUnique({
    where: { id: profileId },
    select: { id: true, name: true, isActive: true },
  })
  if (!profile)
    throw new DeviceImportProfileRuleError('Import profile was not found.')
  const [rules, aliases] = await Promise.all([
    prisma.deviceImportProfileRule.findMany({
      where: { profileId },
      orderBy: [
        { isActive: 'desc' },
        { priority: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        action: true,
        field: true,
        operator: true,
        value: true,
        normalizedValue: true,
        result: true,
        priority: true,
        isActive: true,
      },
    }),
    prisma.deviceImportProfileAlias.findMany({
      where: { profileId },
      orderBy: [{ kind: 'asc' }, { sourceValue: 'asc' }],
      select: {
        id: true,
        kind: true,
        sourceValue: true,
        contextKey: true,
        targetId: true,
      },
    }),
  ])
  return { profile, rules, aliases }
}

export async function createImportProfilePredictionRule(
  profileId: string,
  rawInput: unknown,
) {
  const input = record(rawInput)
  const field = text(input.field)
  const operator = text(input.operator).toUpperCase()
  const value = text(input.value)
  const rawResult = record(input.result)
  if (!IMPORT_PREDICTION_FIELDS.includes(field as never))
    throw new DeviceImportProfileRuleError(
      'Choose a supported rule condition field.',
    )
  if (!IMPORT_PREDICTION_OPERATORS.includes(operator as never))
    throw new DeviceImportProfileRuleError(
      'Choose equals, starts with, or contains.',
    )
  if (!value)
    throw new DeviceImportProfileRuleError(
      'Enter the source value this rule should match.',
    )

  const profile = await prisma.deviceImportProfile.findUnique({
    where: { id: profileId },
    select: { id: true, isActive: true },
  })
  if (!profile?.isActive)
    throw new DeviceImportProfileRuleError('Choose an active import profile.')

  const vendorTargetId = text(rawResult.vendorTargetId) || null
  const deviceTypeTargetId = text(rawResult.deviceTypeTargetId) || null
  const productFamilyId = text(rawResult.productFamilyId) || null
  const softwarePlatforms = Array.isArray(rawResult.softwarePlatforms)
    ? [...new Set(rawResult.softwarePlatforms.map(text).filter(Boolean))]
    : text(rawResult.softwarePlatforms)
        .split(',')
        .map((item) => text(item))
        .filter(Boolean)
  const preferredSoftwarePlatform =
    text(rawResult.preferredSoftwarePlatform) || null
  if (
    !vendorTargetId &&
    !deviceTypeTargetId &&
    !productFamilyId &&
    !softwarePlatforms.length &&
    !preferredSoftwarePlatform
  )
    throw new DeviceImportProfileRuleError(
      'Choose at least one prediction output.',
    )

  const [vendor, deviceType, family] = await Promise.all([
    vendorTargetId
      ? prisma.vendor.findFirst({
          where: { id: vendorTargetId, isActive: true },
          select: { id: true },
        })
      : null,
    deviceTypeTargetId
      ? prisma.deviceType.findFirst({
          where: { id: deviceTypeTargetId, isActive: true },
          select: { id: true },
        })
      : null,
    productFamilyId
      ? prisma.deviceModelFamily.findFirst({
          where: { id: productFamilyId, isActive: true },
          select: { id: true, vendorId: true },
        })
      : null,
  ])
  if (vendorTargetId && !vendor)
    throw new DeviceImportProfileRuleError(
      'The selected Vendor is unavailable.',
    )
  if (deviceTypeTargetId && !deviceType)
    throw new DeviceImportProfileRuleError(
      'The selected Device Type is unavailable.',
    )
  if (productFamilyId && !family)
    throw new DeviceImportProfileRuleError(
      'The selected Product Family is unavailable.',
    )
  if (family && vendorTargetId && family.vendorId !== vendorTargetId)
    throw new DeviceImportProfileRuleError(
      'The Product Family belongs to another Vendor.',
    )

  const result: DeviceImportPredictionResult = {
    vendorTargetId,
    deviceTypeTargetId,
    productFamilyId,
    softwarePlatforms,
    preferredSoftwarePlatform,
    origin: 'MANUAL',
  }
  return prisma.deviceImportProfileRule.upsert({
    where: {
      profileId_action_field_operator_normalizedValue: {
        profileId,
        action: 'PREDICT',
        field,
        operator,
        normalizedValue: normalizeImportText(value),
      },
    },
    update: { value, result, priority: 500, isActive: true },
    create: {
      profileId,
      action: 'PREDICT',
      field,
      operator,
      value,
      normalizedValue: normalizeImportText(value),
      result,
      priority: 500,
      isActive: true,
    },
    select: {
      id: true,
      action: true,
      field: true,
      operator: true,
      value: true,
      normalizedValue: true,
      result: true,
      priority: true,
      isActive: true,
    },
  })
}

export async function updateImportProfileRule(
  profileId: string,
  ruleId: string,
  rawInput: unknown,
) {
  const input = record(rawInput)
  const existing = await prisma.deviceImportProfileRule.findFirst({
    where: { id: ruleId, profileId },
    select: { id: true },
  })
  if (!existing)
    throw new DeviceImportProfileRuleError('Import rule was not found.')
  if (typeof input.isActive !== 'boolean')
    throw new DeviceImportProfileRuleError('Choose whether the rule is active.')
  return prisma.deviceImportProfileRule.update({
    where: { id: ruleId },
    data: { isActive: input.isActive },
    select: { id: true, isActive: true },
  })
}

export async function deleteImportProfileRule(
  profileId: string,
  ruleId: string,
) {
  const deleted = await prisma.deviceImportProfileRule.deleteMany({
    where: { id: ruleId, profileId },
  })
  if (!deleted.count)
    throw new DeviceImportProfileRuleError('Import rule was not found.')
  return { deleted: true }
}
