import type { ImporterV2StagedRow } from '@/lib/importer-v2-evaluator'

export type InventorySourceDefinition = {
  id?: string
  provider: string
  adapterType: string
  sourceAdapterId: string
  name: string
  enabled: boolean
  /**
   * Non-secret adapter configuration only. Credential storage belongs to the
   * secure integration-connection work that follows Issue #80.
   */
  configuration: Record<string, unknown>
  metadata?: Record<string, unknown> | null
}

export type NormalizedInventorySourceRow = ImporterV2StagedRow & {
  /**
   * Raw source evidence is carried beside normalized importer fields so review
   * can remain transport-agnostic after the adapter boundary.
   */
  sourceEvidence?: Record<string, unknown>
}

export type NormalizedInventorySource = {
  source: InventorySourceDefinition
  rows: readonly NormalizedInventorySourceRow[]
  metadata?: Record<string, unknown> | null
}

export interface InventorySourceAdapter<TInput> {
  readonly adapterType: string

  /**
   * Load/translate one source payload into Importer v2 staged rows.
   *
   * Adapters stop here. Hierarchy resolution, identity/crosswalk matching,
   * firmware interpretation, repeat-diff, QA and publication stay in the
   * existing Importer v2 pipeline.
   */
  loadAndNormalize(input: {
    source: InventorySourceDefinition
    input: TInput
  }): Promise<NormalizedInventorySource> | NormalizedInventorySource
}

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

const CANONICAL_INVENTORY_PROVIDERS = new Map([
  ['auvik', 'AUVIK'],
])

export function normalizeInventoryProvider(
  value: string | null | undefined,
): string | null {
  const normalized = clean(value)
  if (!normalized) return null
  return CANONICAL_INVENTORY_PROVIDERS.get(
    normalized.toLocaleLowerCase('en-US'),
  ) ?? normalized
}

export function normalizeInventorySourceDefinition(
  input: InventorySourceDefinition,
): InventorySourceDefinition {
  const provider = normalizeInventoryProvider(input.provider)
  const adapterType = clean(input.adapterType)
  const sourceAdapterId = clean(input.sourceAdapterId)
  const name = clean(input.name)

  if (!provider) throw new Error('Inventory source provider is required.')
  if (!adapterType) throw new Error('Inventory source adapter type is required.')
  if (!sourceAdapterId) throw new Error('Inventory source adapter identity is required.')
  if (!name) throw new Error('Inventory source name is required.')

  return {
    ...input,
    provider,
    adapterType,
    sourceAdapterId,
    name,
    configuration: { ...input.configuration },
    metadata: input.metadata ? { ...input.metadata } : null,
  }
}

export function normalizedInventorySource(input: NormalizedInventorySource) {
  const source = normalizeInventorySourceDefinition(input.source)
  return {
    source,
    rows: input.rows.map((row) => ({
      ...row,
      rawValues: { ...row.rawValues },
      sourceEvidence: row.sourceEvidence ? { ...row.sourceEvidence } : undefined,
    })),
    metadata: input.metadata ? { ...input.metadata } : null,
  } satisfies NormalizedInventorySource
}
