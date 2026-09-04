import type {
  ImporterV2Field,
  ImporterV2ProposedValue,
  ImporterV2StagedRow,
} from '@/lib/importer-v2-evaluator'

export type ImporterV2RuleStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED'
export type ImporterV2RuleBooleanOperator = 'AND' | 'OR'
export type ImporterV2RuleConditionOperator =
  | 'EXACT'
  | 'NORMALIZED_EXACT'
  | 'CONTAINS'
  | 'PREFIX'
  | 'PATTERN'
  | 'VERSION_MATCH'

export type ImporterV2RuleCondition = {
  kind: 'CONDITION'
  field: ImporterV2Field
  operator: ImporterV2RuleConditionOperator
  value: string
  caseSensitive?: boolean
}

export type ImporterV2RuleConditionGroup = {
  kind: 'GROUP'
  operator: ImporterV2RuleBooleanOperator
  items: readonly ImporterV2RuleExpression[]
}

export type ImporterV2RuleExpression =
  | ImporterV2RuleCondition
  | ImporterV2RuleConditionGroup

export type ImporterV2RuleScope = {
  profileIds?: readonly string[]
  providers?: readonly string[]
  sourceAdapterIds?: readonly string[]
  customers?: readonly string[]
  businessUnits?: readonly string[]
  sites?: readonly string[]
  vendors?: readonly string[]
  models?: readonly string[]
  productFamilies?: readonly string[]
  deviceTypes?: readonly string[]
  sourceFields?: readonly ImporterV2Field[]
}

export type ImporterV2RuleAction =
  | {
      type: 'MAP_VALUE'
      field: ImporterV2Field
      target: ImporterV2ProposedValue
    }
  | {
      type: 'SET_FIELD'
      field: ImporterV2Field
      value: string
    }
  | {
      type: 'CLEAR_FIELD'
      field: ImporterV2Field
    }
  | {
      type: 'IGNORE_FIELD'
      field: ImporterV2Field
    }
  | {
      type: 'EXCLUDE_ROW'
      reason: string
    }
  | {
      type: 'TRANSFORM_VALUE'
      field: ImporterV2Field
      transform:
        | 'TRIM'
        | 'LOWERCASE'
        | 'UPPERCASE'
        | 'NORMALIZE_WHITESPACE'
        | 'REPLACE_LITERAL'
      search?: string
      replacement?: string
    }
  | {
      type: 'SPLIT_HIERARCHY'
      sourceField: ImporterV2Field
      delimiter: string
      targetFields: readonly ('customer' | 'businessUnit' | 'site')[]
    }
  | {
      type: 'MATCH_DEVICE'
      deviceId: string
      explanation: string
    }

export type ImporterV2RuleDefinition = {
  id: string
  version: number
  name: string
  description?: string | null
  priority: number
  status: ImporterV2RuleStatus
  scope: ImporterV2RuleScope
  when: ImporterV2RuleExpression
  actions: readonly ImporterV2RuleAction[]
}

export type ImporterV2RuleSetSnapshot = {
  ruleBookId: string
  revisionId: string
  version: number
  rules: readonly ImporterV2RuleDefinition[]
}

export type ImporterV2ExactMappingDefinition = {
  id: string
  mappingKey: string
  version: number
  provider: string
  profileId?: string | null
  field: ImporterV2Field
  normalizedInput: string
  target: ImporterV2ProposedValue
  explanation: string
  isActive: boolean
}

export type ImporterV2RuleContext = {
  profileId: string
  provider: string
  sourceAdapterId: string
}

export type ImporterV2RuleMatchedCondition = {
  field: ImporterV2Field
  operator: ImporterV2RuleConditionOperator
  expected: string
  actual: string | null
  matched: boolean
}

export type ImporterV2RuleApplicationTrace = {
  ruleId: string
  ruleVersion: number
  ruleName: string
  priority: number
  actionIndex: number
  action: ImporterV2RuleAction
  conditions: readonly ImporterV2RuleMatchedCondition[]
}

export type ImporterV2RuleConflict = {
  slot: string
  priority: number
  specificity: number
  ruleIds: readonly string[]
  actionIndexes: readonly number[]
  explanation: string
}

export type ImporterV2RuleFieldOutcome = {
  field: ImporterV2Field
  originalValue: string | null
  effectiveValue: string | null
  mappedTarget: ImporterV2ProposedValue | null
  ignored: boolean
  applied: readonly ImporterV2RuleApplicationTrace[]
}

export type ImporterV2RuleDeviceMatchProposal = {
  deviceId: string
  explanation: string
  ruleId: string
  ruleVersion: number
  requiresConfirmation: true
}

export type ImporterV2RuleRowEvaluation = {
  rowNumber: number
  originalRow: ImporterV2StagedRow
  effectiveRow: ImporterV2StagedRow
  fields: Readonly<Partial<Record<ImporterV2Field, ImporterV2RuleFieldOutcome>>>
  excluded: boolean
  exclusionDecision: {
    ruleId: string
    ruleVersion: number
    explanation: string
  } | null
  deviceMatch: ImporterV2RuleDeviceMatchProposal | null
  applied: readonly ImporterV2RuleApplicationTrace[]
  conflicts: readonly ImporterV2RuleConflict[]
  candidateRuleCount: number
}

export type ImporterV2CompiledRuleSet = {
  snapshot: ImporterV2RuleSetSnapshot
  activeRules: readonly ImporterV2RuleDefinition[]
  broadRuleIndexes: readonly number[]
  anchorIndex: ReadonlyMap<string, readonly number[]>
}

export type ImporterV2RulePreviewExample = {
  rowNumber: number
  before: Partial<Record<ImporterV2Field, string | null>>
  after: Partial<Record<ImporterV2Field, string | null>>
  excluded: boolean
  conflicts: readonly ImporterV2RuleConflict[]
}

export type ImporterV2RulePreview = {
  matchedRowCount: number
  excludedRowCount: number
  changedFields: readonly ImporterV2Field[]
  affectedCustomers: readonly string[]
  affectedSites: readonly string[]
  affectedModels: readonly string[]
  conflicts: readonly ImporterV2RuleConflict[]
  examples: readonly ImporterV2RulePreviewExample[]
  requiresExplicitConfirmation: boolean
  confirmationReasons: readonly string[]
}
