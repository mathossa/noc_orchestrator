import { createHash } from 'node:crypto'

function normalized(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

/**
 * Some source exports (notably Auvik XLSX) expose a logical stack and its
 * members but omit a provider object ID for the stack row. The stack must not
 * borrow a physical member serial/MAC. Instead we derive an explicitly marked
 * source key from the already-validated logical stack grouping context.
 *
 * This is a source crosswalk key, not a hardware identifier. If a real provider
 * source ID is available it always wins and this helper is not used.
 */
export function importerV2DerivedStackSourceId(input: {
  provider: string
  sourceAdapterId: string
  groupKey: string
}) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        provider: normalized(input.provider),
        sourceAdapterId: normalized(input.sourceAdapterId),
        groupKey: normalized(input.groupKey),
      }),
    )
    .digest('hex')
    .slice(0, 32)

  return `derived-stack:${digest}`
}
