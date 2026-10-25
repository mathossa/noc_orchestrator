// SPDX-License-Identifier: AGPL-3.0-only

function withQuery(path: string, values: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? path + '?' + query : path
}

export function firmwareReviewCycleHref(cycleId: string, version?: number | null) {
  return withQuery('/reports/' + encodeURIComponent(cycleId), {
    version: version && version > 0 ? version : null,
  })
}

export function firmwareReviewSiteHref(customerId: string, siteId: string) {
  return (
    '/customers/' +
    encodeURIComponent(customerId) +
    '/sites/' +
    encodeURIComponent(siteId)
  )
}

export function firmwareReviewInventoryHref(input: {
  customerId: string
  siteId?: string | null
  deviceTypeId?: string | null
  modelId?: string | null
}) {
  let path = '/devices/customers/' + encodeURIComponent(input.customerId)
  if (input.siteId) {
    path += '/sites/' + encodeURIComponent(input.siteId)
    if (input.deviceTypeId)
      path += '/types/' + encodeURIComponent(input.deviceTypeId)
  }
  return withQuery(path, { model: input.modelId })
}

export function firmwareReviewPlanHref(planId: string) {
  return '/planning/' + encodeURIComponent(planId)
}

export function firmwareReviewExceptionHref(scope: string, scopeId: string) {
  return withQuery('/firmware/exceptions', { scope, scopeId })
}

export function firmwareReviewReleaseHref(releaseId: string) {
  return '/firmware/' + encodeURIComponent(releaseId)
}

export function firmwareReviewTrainHref(trainId: string) {
  return '/firmware/trains/' + encodeURIComponent(trainId)
}
