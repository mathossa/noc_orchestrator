import {
  parseImporterV2Hierarchy,
  type ImporterV2HierarchyCorrection,
  type ImporterV2HierarchyResult,
  type ImporterV2HierarchyTemplate,
} from '@/lib/importer-v2-hierarchy'

export type ImporterV2DeviceTypeAction = 'INCLUDE' | 'EXCLUDE' | 'REVIEW'

export type ImporterV2DeviceTypeRule = {
  id: string
  sourceValues: readonly string[]
  action: ImporterV2DeviceTypeAction
  explanation: string
}

export type ImporterV2DeviceTypePolicy = {
  version: string
  defaultAction: Exclude<ImporterV2DeviceTypeAction, 'EXCLUDE'>
  rules: readonly ImporterV2DeviceTypeRule[]
}

export type ImporterV2DeviceTypeDecision = {
  rawValue: string | null
  normalizedValue: string | null
  action: ImporterV2DeviceTypeAction
  source: 'PROFILE_RULE' | 'DEFAULT_POLICY' | 'UNKNOWN_TYPE' | 'RULE_CONFLICT'
  matchedRuleIds: readonly string[]
  explanation: string
}

export type ImporterV2ProfilePreviewRow = {
  rowNumber: number
  organizationValue: string | null
  deviceType: string | null
  hierarchyCorrection?: ImporterV2HierarchyCorrection | null
}

export type ImporterV2EvaluatedPreviewRow = {
  rowNumber: number
  status: 'INCLUDED' | 'EXCLUDED' | 'REVIEW'
  hierarchy: ImporterV2HierarchyResult
  deviceType: ImporterV2DeviceTypeDecision
  explanation: string
}

export type ImporterV2ProfilePreview = {
  counts: {
    total: number
    included: number
    excluded: number
    review: number
    nonconformingHierarchy: number
  }
  rows: readonly ImporterV2EvaluatedPreviewRow[]
  samples: {
    included: readonly ImporterV2EvaluatedPreviewRow[]
    excluded: readonly ImporterV2EvaluatedPreviewRow[]
    review: readonly ImporterV2EvaluatedPreviewRow[]
  }
}

function normalize(value: string | null | undefined) {
  if (value === null || value === undefined) return null
  const result = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')
  return result || null
}

const REVIEW_DEVICE_TYPES = new Set([
  'unknown',
  'generic device',
  'generic',
  'other',
  '',
])

export function evaluateImporterV2DeviceType(
  rawValue: string | null | undefined,
  policy: ImporterV2DeviceTypePolicy,
): ImporterV2DeviceTypeDecision {
  const normalizedValue = normalize(rawValue)
  const matches = policy.rules
    .filter((rule) =>
      rule.sourceValues.some((value) => normalize(value) === normalizedValue),
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
  const actions = new Set(matches.map((rule) => rule.action))

  if (actions.size > 1) {
    return {
      rawValue: rawValue ?? null,
      normalizedValue,
      action: 'REVIEW',
      source: 'RULE_CONFLICT',
      matchedRuleIds: matches.map((rule) => rule.id),
      explanation: 'Conflicting device-type rules require review.',
    }
  }

  if (matches[0]) {
    return {
      rawValue: rawValue ?? null,
      normalizedValue,
      action: matches[0].action,
      source: 'PROFILE_RULE',
      matchedRuleIds: matches.map((rule) => rule.id),
      explanation: matches[0].explanation,
    }
  }

  if (REVIEW_DEVICE_TYPES.has(normalizedValue ?? '')) {
    return {
      rawValue: rawValue ?? null,
      normalizedValue,
      action: 'REVIEW',
      source: 'UNKNOWN_TYPE',
      matchedRuleIds: [],
      explanation:
        'Unknown and generic device types require an explicit inclusion or exclusion decision.',
    }
  }

  return {
    rawValue: rawValue ?? null,
    normalizedValue,
    action: policy.defaultAction,
    source: 'DEFAULT_POLICY',
    matchedRuleIds: [],
    explanation:
      policy.defaultAction === 'INCLUDE'
        ? 'The confirmed profile includes device types unless a rule says otherwise.'
        : 'The confirmed profile requires review for device types without an explicit rule.',
  }
}

function previewStatus(
  hierarchy: ImporterV2HierarchyResult,
  deviceType: ImporterV2DeviceTypeDecision,
) {
  if (deviceType.action === 'EXCLUDE') return 'EXCLUDED' as const
  if (hierarchy.status === 'NONCONFORMING' || deviceType.action === 'REVIEW') {
    return 'REVIEW' as const
  }
  return 'INCLUDED' as const
}

export function previewImporterV2Profile(
  rows: readonly ImporterV2ProfilePreviewRow[],
  hierarchyTemplate: ImporterV2HierarchyTemplate,
  deviceTypePolicy: ImporterV2DeviceTypePolicy,
  sampleLimit = 10,
): ImporterV2ProfilePreview {
  const boundedSampleLimit = Math.max(1, Math.min(100, Math.floor(sampleLimit)))
  const evaluatedRows = rows.map((row) => {
    const hierarchy = parseImporterV2Hierarchy(
      row.rowNumber,
      row.organizationValue,
      hierarchyTemplate,
      row.hierarchyCorrection,
    )
    const deviceType = evaluateImporterV2DeviceType(
      row.deviceType,
      deviceTypePolicy,
    )
    const status = previewStatus(hierarchy, deviceType)
    return {
      rowNumber: row.rowNumber,
      status,
      hierarchy,
      deviceType,
      explanation:
        status === 'EXCLUDED'
          ? `Excluded by profile rule ${deviceType.matchedRuleIds.join(', ')}: ${deviceType.explanation}`
          : status === 'REVIEW'
            ? 'This row remains visible and requires a hierarchy or device-type decision.'
            : 'The hierarchy and device type conform to the confirmed profile.',
    } satisfies ImporterV2EvaluatedPreviewRow
  })

  const byStatus = (status: ImporterV2EvaluatedPreviewRow['status']) =>
    evaluatedRows.filter((row) => row.status === status)
  const included = byStatus('INCLUDED')
  const excluded = byStatus('EXCLUDED')
  const review = byStatus('REVIEW')

  return {
    counts: {
      total: evaluatedRows.length,
      included: included.length,
      excluded: excluded.length,
      review: review.length,
      nonconformingHierarchy: evaluatedRows.filter(
        (row) => row.hierarchy.status === 'NONCONFORMING',
      ).length,
    },
    rows: evaluatedRows,
    samples: {
      included: included.slice(0, boundedSampleLimit),
      excluded: excluded.slice(0, boundedSampleLimit),
      review: review.slice(0, boundedSampleLimit),
    },
  }
}
