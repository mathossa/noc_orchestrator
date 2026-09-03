import { normalizeImportText } from '@/lib/device-import'
import {
  IMPORT_PREDICTION_FIELDS,
  IMPORT_PREDICTION_OPERATORS,
  type DeviceImportModelTransform,
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

function modelTransforms(value: unknown, strict = false) {
  if (!Array.isArray(value)) return []
  const transforms: DeviceImportModelTransform[] = []
  for (const entry of value) {
    const transform = record(entry)
    const operation = text(transform.operation).toUpperCase()
    const transformValue = text(transform.value)
    const replacement = text(transform.replacement)
    if (!['REMOVE_PREFIX', 'REPLACE'].includes(operation) || !transformValue) {
      if (strict)
        throw new DeviceImportProfileRuleError(
          'Choose a valid Model cleanup operation and value.',
        )
      continue
    }
    if (transformValue.length > 120 || replacement.length > 120)
      throw new DeviceImportProfileRuleError(
        'Model cleanup values must be 120 characters or fewer.',
      )
    transforms.push({
      operation: operation as DeviceImportModelTransform['operation'],
      value: transformValue,
      ...(operation === 'REPLACE' ? { replacement } : {}),
    })
  }
  return transforms
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

  const normalizedValue = normalizeImportText(value)
  const existingRule = await prisma.deviceImportProfileRule.findUnique({
    where: {
      profileId_action_field_operator_normalizedValue: {
        profileId,
        action: 'PREDICT',
        field,
        operator,
        normalizedValue,
      },
    },
    select: { result: true },
  })
  const existingResult = record(existingRule?.result)

  const requestedVendorTargetId = text(rawResult.vendorTargetId) || null
  const requestedDeviceTypeTargetId = text(rawResult.deviceTypeTargetId) || null
  const requestedProductFamilyId = text(rawResult.productFamilyId) || null
  const requestedSoftwarePlatforms = Array.isArray(rawResult.softwarePlatforms)
    ? [...new Set(rawResult.softwarePlatforms.map(text).filter(Boolean))]
    : text(rawResult.softwarePlatforms)
        .split(',')
        .map((item) => text(item))
        .filter(Boolean)
  const requestedPreferredSoftwarePlatform =
    text(rawResult.preferredSoftwarePlatform) || null
  const requestedModelTransforms = modelTransforms(
    rawResult.modelTransforms,
    true,
  )
  if (
    !requestedVendorTargetId &&
    !requestedDeviceTypeTargetId &&
    !requestedProductFamilyId &&
    !requestedSoftwarePlatforms.length &&
    !requestedPreferredSoftwarePlatform &&
    !requestedModelTransforms.length
  )
    throw new DeviceImportProfileRuleError(
      'Choose at least one prediction output.',
    )

  const vendorTargetId =
    requestedVendorTargetId || text(existingResult.vendorTargetId) || null
  const deviceTypeTargetId =
    requestedDeviceTypeTargetId ||
    text(existingResult.deviceTypeTargetId) ||
    null
  const productFamilyId =
    requestedProductFamilyId || text(existingResult.productFamilyId) || null
  const existingSoftwarePlatforms = Array.isArray(
    existingResult.softwarePlatforms,
  )
    ? existingResult.softwarePlatforms.map(text).filter(Boolean)
    : []
  const softwarePlatforms = requestedSoftwarePlatforms.length
    ? requestedSoftwarePlatforms
    : existingSoftwarePlatforms
  const preferredSoftwarePlatform =
    requestedPreferredSoftwarePlatform ||
    text(existingResult.preferredSoftwarePlatform) ||
    null
  const existingModelTransforms = modelTransforms(
    existingResult.modelTransforms,
  )
  const modelTransformKeys = new Set(
    requestedModelTransforms.map(
      (transform) =>
        `${transform.operation}|${normalizeImportText(transform.value)}|${normalizeImportText(transform.replacement)}`,
    ),
  )
  const modelTransformsResult = [
    ...requestedModelTransforms,
    ...existingModelTransforms.filter(
      (transform) =>
        !modelTransformKeys.has(
          `${transform.operation}|${normalizeImportText(transform.value)}|${normalizeImportText(transform.replacement)}`,
        ),
    ),
  ]

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
    modelTransforms: modelTransformsResult,
    origin: 'MANUAL',
  }
  return prisma.deviceImportProfileRule.upsert({
    where: {
      profileId_action_field_operator_normalizedValue: {
        profileId,
        action: 'PREDICT',
        field,
        operator,
        normalizedValue,
      },
    },
    update: { value, result, priority: 500, isActive: true },
    create: {
      profileId,
      action: 'PREDICT',
      field,
      operator,
      value,
      normalizedValue,
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
