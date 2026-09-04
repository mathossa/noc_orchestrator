export type ImporterV2HierarchyTarget = 'customer' | 'businessUnit' | 'site'

export type ImporterV2HierarchyAssignment =
  | {
      target: ImporterV2HierarchyTarget
      source: 'SEGMENT'
      index: number
    }
  | {
      target: ImporterV2HierarchyTarget
      source: 'REMAINDER'
      fromIndex: number
    }

export type ImporterV2HierarchyVariant = {
  id: string
  minSegments: number
  maxSegments: number | null
  assignments: readonly ImporterV2HierarchyAssignment[]
}

export type ImporterV2HierarchyTemplate = {
  id: string
  version: string
  delimiter: string
  variants: readonly ImporterV2HierarchyVariant[]
}

export type ImporterV2HierarchyValues = Record<
  ImporterV2HierarchyTarget,
  string | null
>

export type ImporterV2HierarchyCorrection = Partial<ImporterV2HierarchyValues>

export type ImporterV2HierarchyIssue = {
  code:
    | 'EMPTY_VALUE'
    | 'EMPTY_SEGMENT'
    | 'NO_MATCHING_VARIANT'
    | 'AMBIGUOUS_VARIANT'
    | 'MISSING_CUSTOMER'
  message: string
  resolvedByCorrection: boolean
}

export type ImporterV2HierarchyResult = {
  rowNumber: number
  rawValue: string | null
  segments: readonly string[]
  matchedVariantId: string | null
  parsedValues: ImporterV2HierarchyValues
  effectiveValues: ImporterV2HierarchyValues
  correction: ImporterV2HierarchyCorrection | null
  status: 'PARSED' | 'CORRECTED' | 'NONCONFORMING'
  issues: readonly ImporterV2HierarchyIssue[]
}

export class ImporterV2HierarchyTemplateError extends Error {
  constructor(readonly errors: readonly string[]) {
    super('The hierarchy template is invalid.')
    this.name = 'ImporterV2HierarchyTemplateError'
  }
}

function clean(value: string | null | undefined) {
  if (value === null || value === undefined) return null
  const result = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return result || null
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function emptyValues(): ImporterV2HierarchyValues {
  return { customer: null, businessUnit: null, site: null }
}

function rangeWidth(variant: ImporterV2HierarchyVariant) {
  return variant.maxSegments === null
    ? Number.POSITIVE_INFINITY
    : variant.maxSegments - variant.minSegments
}

export function validateImporterV2HierarchyTemplate(
  template: ImporterV2HierarchyTemplate,
) {
  const errors: string[] = []
  if (!clean(template.delimiter)) errors.push('Delimiter is required.')
  if (template.variants.length === 0)
    errors.push('At least one hierarchy variant is required.')

  const variantIds = new Set<string>()
  for (const variant of template.variants) {
    if (!variant.id.trim()) errors.push('Every hierarchy variant needs an ID.')
    else if (variantIds.has(variant.id))
      errors.push(`Hierarchy variant ID “${variant.id}” is duplicated.`)
    variantIds.add(variant.id)

    if (!Number.isInteger(variant.minSegments) || variant.minSegments < 1) {
      errors.push(`Variant “${variant.id}” must start at one or more segments.`)
    }
    if (
      variant.maxSegments !== null &&
      (!Number.isInteger(variant.maxSegments) ||
        variant.maxSegments < variant.minSegments)
    ) {
      errors.push(
        `Variant “${variant.id}” has an invalid maximum segment count.`,
      )
    }

    const targets = variant.assignments.map((assignment) => assignment.target)
    if (!targets.includes('customer')) {
      errors.push(`Variant “${variant.id}” must assign a Customer.`)
    }
    if (new Set(targets).size !== targets.length) {
      errors.push(
        `Variant “${variant.id}” assigns the same hierarchy field more than once.`,
      )
    }

    for (const assignment of variant.assignments) {
      const index =
        assignment.source === 'SEGMENT'
          ? assignment.index
          : assignment.fromIndex
      if (!Number.isInteger(index) || index < 0) {
        errors.push(
          `Variant “${variant.id}” contains an invalid segment index.`,
        )
      }
    }
  }

  if (errors.length > 0) throw new ImporterV2HierarchyTemplateError(errors)
}

function matchingVariant(
  variants: readonly ImporterV2HierarchyVariant[],
  segmentCount: number,
) {
  const candidates = variants
    .filter(
      (variant) =>
        segmentCount >= variant.minSegments &&
        (variant.maxSegments === null || segmentCount <= variant.maxSegments),
    )
    .toSorted(
      (left, right) =>
        rangeWidth(left) - rangeWidth(right) ||
        right.minSegments - left.minSegments ||
        left.id.localeCompare(right.id),
    )
  const best = candidates[0]
  if (!best) return { variant: null, ambiguous: false }
  const bestWidth = rangeWidth(best)
  const equallySpecific = candidates.filter(
    (candidate) =>
      rangeWidth(candidate) === bestWidth &&
      candidate.minSegments === best.minSegments,
  )
  return { variant: best, ambiguous: equallySpecific.length > 1 }
}

function valuesForVariant(
  variant: ImporterV2HierarchyVariant,
  segments: readonly string[],
  delimiter: string,
) {
  const values = emptyValues()
  for (const assignment of variant.assignments) {
    const value =
      assignment.source === 'SEGMENT'
        ? segments[assignment.index]
        : segments.slice(assignment.fromIndex).join(delimiter)
    values[assignment.target] = clean(value)
  }
  return values
}

function correctedValues(
  parsedValues: ImporterV2HierarchyValues,
  correction: ImporterV2HierarchyCorrection | null | undefined,
) {
  const result = { ...parsedValues }
  if (!correction) return result
  for (const target of ['customer', 'businessUnit', 'site'] as const) {
    if (target in correction) result[target] = clean(correction[target])
  }
  return result
}

export function parseImporterV2Hierarchy(
  rowNumber: number,
  rawValue: string | null | undefined,
  template: ImporterV2HierarchyTemplate,
  correction?: ImporterV2HierarchyCorrection | null,
): ImporterV2HierarchyResult {
  validateImporterV2HierarchyTemplate(template)
  const cleanedRaw = clean(rawValue)
  const literalDelimiter = template.delimiter.trim()
  const delimiterPattern = new RegExp(
    `\\s*${escapedPattern(literalDelimiter)}\\s*`,
  )
  const segments = cleanedRaw
    ? rawValue!
        .normalize('NFKC')
        .trim()
        .split(delimiterPattern)
        .map((segment) => clean(segment) ?? '')
    : []
  const issues: ImporterV2HierarchyIssue[] = []
  let matchedVariant: ImporterV2HierarchyVariant | null = null
  let parsedValues = emptyValues()

  if (!cleanedRaw) {
    issues.push({
      code: 'EMPTY_VALUE',
      message: 'The organization hierarchy value is empty.',
      resolvedByCorrection: false,
    })
  } else if (segments.some((segment) => !segment)) {
    issues.push({
      code: 'EMPTY_SEGMENT',
      message: 'The organization hierarchy contains an empty segment.',
      resolvedByCorrection: false,
    })
  } else {
    const match = matchingVariant(template.variants, segments.length)
    if (match.ambiguous) {
      issues.push({
        code: 'AMBIGUOUS_VARIANT',
        message:
          'Multiple equally specific hierarchy variants match this value.',
        resolvedByCorrection: false,
      })
    } else if (!match.variant) {
      issues.push({
        code: 'NO_MATCHING_VARIANT',
        message: `No hierarchy variant accepts ${segments.length} segment${segments.length === 1 ? '' : 's'}.`,
        resolvedByCorrection: false,
      })
    } else {
      matchedVariant = match.variant
      parsedValues = valuesForVariant(
        match.variant,
        segments,
        template.delimiter,
      )
      if (!parsedValues.customer) {
        issues.push({
          code: 'MISSING_CUSTOMER',
          message: 'The selected hierarchy variant did not produce a Customer.',
          resolvedByCorrection: false,
        })
      }
    }
  }

  const normalizedCorrection = correction
    ? Object.fromEntries(
        Object.entries(correction).map(([target, value]) => [
          target,
          clean(value),
        ]),
      )
    : null
  const effectiveValues = correctedValues(parsedValues, normalizedCorrection)
  const hasCorrection =
    normalizedCorrection !== null &&
    Object.keys(normalizedCorrection).length > 0
  const corrected = hasCorrection && Boolean(effectiveValues.customer)
  const resolvedIssues = issues.map((issue) => ({
    ...issue,
    resolvedByCorrection: corrected,
  }))

  return {
    rowNumber,
    rawValue: rawValue ?? null,
    segments,
    matchedVariantId: matchedVariant?.id ?? null,
    parsedValues,
    effectiveValues,
    correction: normalizedCorrection,
    status: corrected
      ? 'CORRECTED'
      : issues.length > 0
        ? 'NONCONFORMING'
        : 'PARSED',
    issues: resolvedIssues,
  }
}

export const IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE: ImporterV2HierarchyTemplate =
  {
    id: 'customer-business-unit-site',
    version: '1',
    delimiter: ' - ',
    variants: [
      {
        id: 'customer-only',
        minSegments: 1,
        maxSegments: 1,
        assignments: [{ target: 'customer', source: 'SEGMENT', index: 0 }],
      },
      {
        id: 'customer-site',
        minSegments: 2,
        maxSegments: 2,
        assignments: [
          { target: 'customer', source: 'SEGMENT', index: 0 },
          { target: 'site', source: 'SEGMENT', index: 1 },
        ],
      },
      {
        id: 'customer-business-unit-site',
        minSegments: 3,
        maxSegments: 3,
        assignments: [
          { target: 'customer', source: 'SEGMENT', index: 0 },
          { target: 'businessUnit', source: 'SEGMENT', index: 1 },
          { target: 'site', source: 'SEGMENT', index: 2 },
        ],
      },
      {
        id: 'customer-business-unit-site-with-delimiter',
        minSegments: 4,
        maxSegments: null,
        assignments: [
          { target: 'customer', source: 'SEGMENT', index: 0 },
          { target: 'businessUnit', source: 'SEGMENT', index: 1 },
          { target: 'site', source: 'REMAINDER', fromIndex: 2 },
        ],
      },
    ],
  }
