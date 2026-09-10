import { createHash } from 'node:crypto'

function normalized(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')
}

export function isImporterV2AuvikXlsxSource(input: {
  provider: string
  sourceAdapterId: string
}) {
  return (
    normalized(input.provider) === 'auvik' &&
    normalized(input.sourceAdapterId).includes('xlsx')
  )
}

/**
 * Auvik XLSX exports can omit every per-device durable identifier for some
 * devices. In that narrow case, use the same uniqueness boundary as the
 * canonical Device model: customer + device name. This is explicitly marked
 * as derived and is only used after hierarchy/name reconciliation.
 *
 * Site/model are deliberately not part of the key so a later move or model
 * correction does not create a different source identity. They are used as
 * supporting evidence when bootstrapping an already-existing canonical Device.
 */
export function importerV2DerivedAuvikDeviceSourceId(input: {
  provider: string
  customer: string
  deviceName: string
}) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        provider: normalized(input.provider),
        customer: normalized(input.customer),
        deviceName: normalized(input.deviceName),
      }),
    )
    .digest('hex')
    .slice(0, 32)

  return `derived-auvik-device:${digest}`
}

export function importerV2AuvikContextSupportsExistingDevice(input: {
  sourceSite?: string | null
  sourceModel?: string | null
  candidateSite?: string | null
  candidateModel?: string | null
}) {
  const sourceSite = input.sourceSite ? normalized(input.sourceSite) : null
  const sourceModel = input.sourceModel ? normalized(input.sourceModel) : null
  const candidateSite = input.candidateSite ? normalized(input.candidateSite) : null
  const candidateModel = input.candidateModel ? normalized(input.candidateModel) : null

  const siteAgrees = Boolean(sourceSite && candidateSite && sourceSite === candidateSite)
  const modelAgrees = Boolean(sourceModel && candidateModel && sourceModel === candidateModel)

  // Require at least one independent contextual agreement before automatically
  // attaching an identityless source row to an existing canonical Device.
  return siteAgrees || modelAgrees
}
