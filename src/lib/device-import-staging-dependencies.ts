import { normalizeImportText, type DeviceImportReferenceKind } from '@/lib/device-import'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'

export type StagedDependencyReference = {
  kind: string
  normalizedSourceValue: string
  metadata: unknown
}

export type LinkedStagedDependencyReference = {
  kind: string
  normalizedSourceValue: string
  status: string
  targetId: string | null
}

export function currentLinkedDependencyTarget(
  kind: DeviceImportReferenceKind,
  sourceValue: string | null | undefined,
  references: LinkedStagedDependencyReference[],
  fallback: string | null = null,
) {
  if (!sourceValue) return fallback
  const normalizedSourceValue = normalizeImportText(sourceValue)
  const reference = references.find((candidate) =>
    candidate.kind === kind && candidate.normalizedSourceValue === normalizedSourceValue,
  )
  if (!reference) return fallback
  return reference.status === 'LINKED' ? reference.targetId : null
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? (value as DeviceImportStagedReferenceMetadata) : {}
}

function sameSource(value: string | null | undefined, normalizedSourceValue: string) {
  return Boolean(value) && normalizeImportText(value) === normalizedSourceValue
}

export function stagedReferenceDependsOn(
  parent: StagedDependencyReference,
  child: StagedDependencyReference,
) {
  const parentKind = parent.kind as DeviceImportReferenceKind
  const childKind = child.kind as DeviceImportReferenceKind
  const childMeta = metadata(child.metadata)

  if (parentKind === 'CUSTOMER' && childKind === 'SITE') {
    return sameSource(childMeta.customerSourceValue, parent.normalizedSourceValue)
  }

  if (parentKind === 'VENDOR' && childKind === 'DEVICE_MODEL') {
    return sameSource(childMeta.vendorSourceValue, parent.normalizedSourceValue)
  }

  if (parentKind === 'DEVICE_TYPE' && childKind === 'DEVICE_MODEL') {
    return sameSource(childMeta.deviceTypeSourceValue, parent.normalizedSourceValue)
  }

  if (parentKind === 'DEVICE_MODEL' && childKind === 'FIRMWARE_RELEASE') {
    if (!sameSource(childMeta.modelSourceValue, parent.normalizedSourceValue)) return false

    const parentMeta = metadata(parent.metadata)
    if (parentMeta.vendorSourceValue && childMeta.vendorSourceValue) {
      return normalizeImportText(parentMeta.vendorSourceValue) === normalizeImportText(childMeta.vendorSourceValue)
    }
    return true
  }

  return false
}
