/**
 * HPE Aruba Networking Classic Central API client.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Classic Central is NOT New Central: the regional API gateway, token
 * refresh grant and inventory endpoints are independent.
 *
 * Official references:
 * https://developer.arubanetworks.com/central/docs/access-token-management
 * https://developer.arubanetworks.com/central/reference/apiexternal_controllerget_aps_v2
 * https://developer.arubanetworks.com/central/reference/apiexternal_controllerget_switches
 * https://developer.arubanetworks.com/central/reference/apiexternal_controllerget_gateways
 */
import {
  ArubaCentralApiError,
  arubaCentralApiBaseUrl,
  jsonObject,
  requestWithRetry,
  type ArubaCentralClassicConfiguration,
  type RequestPolicy,
} from '@/lib/aruba-central-api-client'

export const ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE = 'aruba-central-classic'
export const ARUBA_CLASSIC_CENTRAL_PAGE_SIZE = 1000

export type ClassicCentralDeviceKind = 'AP' | 'SWITCH' | 'GATEWAY'
export type ClassicCentralDeviceObservation = {
  kind: ClassicCentralDeviceKind
  raw: Record<string, unknown>
}

export type ClassicCentralTokens = {
  accessToken: string
  refreshToken: string
}

export type ClassicCentralClientCredentials = {
  clientId: string
  clientSecret: string
}

/**
 * The caller MUST durably save the new refresh token BEFORE resuming requests.
 * Classic refresh tokens rotate and are only valid for 15 days.
 */
export type ClassicCentralTokenRefresh = {
  credentials: ClassicCentralClientCredentials
  refreshToken: string
  onTokensRotated: (tokens: ClassicCentralTokens) => Promise<void>
}

export type ClassicCentralListInput = {
  configuration: ArubaCentralClassicConfiguration
  accessToken: string
  refresh?: ClassicCentralTokenRefresh
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  maxPagesPerType?: number
  requestPolicy?: RequestPolicy
}

const INVENTORY_ENDPOINTS: ReadonlyArray<{
  kind: ClassicCentralDeviceKind
  path: string
  collection: string
  fields: string
}> = [
  { kind: 'AP', path: '/monitoring/v2/aps', collection: 'aps', fields: 'status,ip_address,model,firmware_version,site,ap_group' },
  { kind: 'SWITCH', path: '/monitoring/v1/switches', collection: 'switches', fields: 'status,macaddr,model,ip_address,firmware_version,site' },
  { kind: 'GATEWAY', path: '/monitoring/v1/gateways', collection: 'gateways', fields: 'status,ip_address,model,firmware_version' },
]

function required(value: string, field: string) {
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) throw new Error(`Classic Central ${field} is required.`)
  return normalized
}

export async function refreshClassicCentralAccessToken(input: {
  configuration: ArubaCentralClassicConfiguration
  credentials: ClassicCentralClientCredentials
  refreshToken: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: RequestPolicy
}): Promise<ClassicCentralTokens> {
  const baseUrl = arubaCentralApiBaseUrl(input.configuration)
  const url = new URL('/oauth2/token', baseUrl)
  // Classic Central documents these as POST query parameters; a New Central
  // client_credentials grant must NEVER be used on Classic Central.
  url.searchParams.set('client_id', required(input.credentials.clientId, 'client ID'))
  url.searchParams.set('client_secret', required(input.credentials.clientSecret, 'client secret'))
  url.searchParams.set('grant_type', 'refresh_token')
  url.searchParams.set('refresh_token', required(input.refreshToken, 'refresh token'))

  const response = await requestWithRetry({
    url,
    fetchImpl: input.fetchImpl ?? fetch,
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: input.signal,
    },
    requestPolicy: input.requestPolicy,
  })
  const value = await jsonObject(response)
  if (
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token
  ) {
    throw new ArubaCentralApiError(
      'Classic Central did not return both rotated OAuth tokens.',
      502,
      false,
    )
  }
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
  }
}

function parsePage(input: { payload: Record<string, unknown>; collection: string }) {
  // Classic gateway inventory is returned under "mcs" in some official
  // Classic payloads, while other deployments return "gateways".
  const candidates = input.payload[input.collection] ??
    (input.collection === 'gateways' ? input.payload.mcs : undefined)
  if (!Array.isArray(candidates)) {
    throw new ArubaCentralApiError(
      `Classic Central returned an invalid ${input.collection} list.`,
      502,
      false,
    )
  }
  const records = candidates.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new ArubaCentralApiError(
        'Classic Central returned an invalid device record.',
        502,
        false,
      )
    }
    return candidate as Record<string, unknown>
  })
  const total = input.payload.total
  if (total != null && (!Number.isSafeInteger(total) || (total as number) < 0)) {
    throw new ArubaCentralApiError(
      'Classic Central returned an invalid total count.',
      502,
      false,
    )
  }
  return { records, total: (total ?? null) as number | null }
}

/**
 * Read the AP, switch and gateway endpoint collections as a single snapshot.
 * Any page failure rejects the whole snapshot so downstream sync cannot mistake
 * a partial API result for complete inventory.
 */
export async function listClassicCentralDevices(input: ClassicCentralListInput):
Promise<ClassicCentralDeviceObservation[]> {
  const baseUrl = arubaCentralApiBaseUrl(input.configuration)
  const accessToken = required(input.accessToken, 'access token')
  const maxPages = input.maxPagesPerType ?? 100
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('Classic Central maxPagesPerType must be positive.')
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const records: ClassicCentralDeviceObservation[] = []
  let currentAccessToken = accessToken
  let currentRefreshToken = input.refresh?.refreshToken ?? null

  for (const endpoint of INVENTORY_ENDPOINTS) {
    let completed = false
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * ARUBA_CLASSIC_CENTRAL_PAGE_SIZE
      const url = new URL(endpoint.path, baseUrl)
      url.searchParams.set('offset', String(offset))
      url.searchParams.set('limit', String(ARUBA_CLASSIC_CENTRAL_PAGE_SIZE))
      url.searchParams.set('calculate_total', 'true')
      url.searchParams.set('fields', endpoint.fields)
      url.searchParams.set('sort', '+serial')

      const requestPage = () =>
        requestWithRetry({
          url,
          fetchImpl,
          init: {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${currentAccessToken}`,
            },
            signal: input.signal,
          },
          requestPolicy: input.requestPolicy,
        })

      let response: Response
      try {
        response = await requestPage()
      } catch (error) {
        if (
          !(error instanceof ArubaCentralApiError) ||
          error.status !== 401 ||
          !input.refresh ||
          !currentRefreshToken
        ) throw error

        const rotated = await refreshClassicCentralAccessToken({
          configuration: input.configuration,
          credentials: input.refresh.credentials,
          refreshToken: currentRefreshToken,
          fetchImpl,
          signal: input.signal,
          requestPolicy: input.requestPolicy,
        })
        // Never continue with a rotated in-memory token while leaving the
        // encrypted durable credential store on the invalidated refresh token.
        await input.refresh.onTokensRotated(rotated)
        currentAccessToken = rotated.accessToken
        currentRefreshToken = rotated.refreshToken
        response = await requestPage()
      }
      const { records: pageRecords, total } = parsePage({
        payload: await jsonObject(response),
        collection: endpoint.collection,
      })
      records.push(...pageRecords.map((raw) => ({ kind: endpoint.kind, raw })))

      if (
        pageRecords.length < ARUBA_CLASSIC_CENTRAL_PAGE_SIZE ||
        (total !== null && offset + pageRecords.length >= total)
      ) {
        completed = true
        break
      }
    }
    if (!completed) {
      throw new ArubaCentralApiError(
        `Classic Central exceeded the ${maxPages}-page safety limit for ${endpoint.kind}.`,
        502,
        false,
      )
    }
  }
  return records
}

/**
 * Explicit, operator-triggered site discovery. Site lists are not polled
 * implicitly on every inventory sync, so user-enabled mapping is durable.
 */
export async function listClassicCentralSites(input: {
  configuration: ArubaCentralClassicConfiguration
  accessToken: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: RequestPolicy
  maxPages?: number
}): Promise<Array<{ id: string | null; name: string }>> {
  const baseUrl = arubaCentralApiBaseUrl(input.configuration)
  const maxPages = input.maxPages ?? 100
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('Classic Central maxPages must be positive.')
  }
  const sites: Array<{ id: string | null; name: string }> = []
  const seen = new Set<string>()
  for (let page = 0; page < maxPages; page++) {
    const url = new URL('/central/v2/sites', baseUrl)
    url.searchParams.set('offset', String(page * ARUBA_CLASSIC_CENTRAL_PAGE_SIZE))
    url.searchParams.set('limit', String(ARUBA_CLASSIC_CENTRAL_PAGE_SIZE))
    url.searchParams.set('calculate_total', 'true')
    const response = await requestWithRetry({
      url,
      fetchImpl: input.fetchImpl ?? fetch,
      init: {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${input.accessToken}`,
        },
        signal: input.signal,
      },
      requestPolicy: input.requestPolicy,
    })
    const payload = await jsonObject(response)
    if (!Array.isArray(payload.sites)) {
      throw new ArubaCentralApiError(
        'Classic Central returned an invalid sites list.', 502, false,
      )
    }
    for (const item of payload.sites) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new ArubaCentralApiError('Classic Central returned an invalid site.', 502, false)
      }
      const record = item as Record<string, unknown>
      const name = record.site_name ?? record.name
      if (typeof name !== 'string' || !name.trim()) {
        throw new ArubaCentralApiError('Classic Central site has no name.', 502, false)
      }
      const normalizedName = name.normalize('NFKC').trim()
      if (!seen.has(normalizedName.toLowerCase())) {
        sites.push({
          name: normalizedName,
          id: typeof record.site_id === 'string' || typeof record.site_id === 'number'
            ? String(record.site_id)
            : typeof record.id === 'string' || typeof record.id === 'number'
              ? String(record.id) : null,
        })
        seen.add(normalizedName.toLowerCase())
      }
    }
    if (payload.sites.length < ARUBA_CLASSIC_CENTRAL_PAGE_SIZE) return sites
  }
  throw new ArubaCentralApiError('Classic Central sites exceeded the page safety limit.',502,false)
}
