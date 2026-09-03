import { normalizeImportText } from '@/lib/device-import'

const VENDOR_PREFIX =
  /^(?:hewlett\s+packard\s+enterprise|hpe\s+networking|hpe\s+aruba|fortinet|cisco|aruba)[\s._/-]+/i
const FORTINET_FAMILY_PREFIX = /^(?:fortigate|fortiswitch|fortiap)[\s._/-]*/i
const FORTINET_MODEL_PREFIX = /^(?:fg|fs|fap)[\s._/-]*/i

/**
 * Produces a deliberately strict hardware identity for deciding whether a
 * suggested existing Model is safe to preselect. Commercial/vendor prefixes
 * may differ, but the actual hardware suffix must remain identical. This keeps
 * 70G and 70F, or 100F and 101F, as different Models.
 */
export function canonicalImportModelIdentity(value: string) {
  let model = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  model = model.replace(VENDOR_PREFIX, '')
  model = model.replace(FORTINET_FAMILY_PREFIX, '')
  model = model.replace(FORTINET_MODEL_PREFIX, '')
  return normalizeImportText(model).replace(/[^a-z0-9]+/g, '')
}

export function isSafeExistingModelPrediction(
  sourceValue: string,
  targetModel: string,
) {
  const source = canonicalImportModelIdentity(sourceValue)
  const target = canonicalImportModelIdentity(targetModel)
  return Boolean(source && target && source === target)
}
