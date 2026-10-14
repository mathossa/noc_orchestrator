import { Buffer } from 'node:buffer'

export const AUVIK_DEVICE_V2_PATH = '/v2/api/inventory/device/info'
export const AUVIK_VERIFY_CREDENTIALS_PATH = '/authentication/verify'
export const AUVIK_TENANTS_PATH = '/v1/tenants'
export const AUVIK_TENANT_DETAILS_PATH = '/v1/tenants/detail'
export const AUVIK_DEVICE_V2_PAGE_SIZE = 1000
export const AUVIK_RATE_LIMIT_REQUESTS = 2500
export const AUVIK_RATE_LIMIT_WINDOW_SECONDS = 5 * 60

export type AuvikApiCredentials = {
  username: string
  apiKey: string
}

export type AuvikDeviceV2Attributes = {
  deviceName?: string | null
  hostname?: string | null
  make?: string | null
  model?: string | null
  deviceType?: string | null
  deviceTypeDescription?: string | null
  serialNumber?: string | null
  macAddress?: string | null
  macAddresses?: readonly string[] | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
  ipAddresses?: readonly string[] | null
  [key: string]: unknown
}

export type AuvikJsonApiRelationship = {
  data?:
    | {
        type?: string
        id: string
      }
    | readonly {
        type?: string
        id: string
      }[]
    | null
}

export type AuvikDeviceV2Resource = {
  type: string
  id: string
  attributes: AuvikDeviceV2Attributes
  relationships?: {
    tenant?: AuvikJsonApiRelationship
    networks?: AuvikJsonApiRelationship
    [key: string]: AuvikJsonApiRelationship | undefined
  }
}

export type AuvikDeviceV2Page = {
  data: readonly AuvikDeviceV2Resource[]
  links?: {
    next?: string | null
    [key: string]: unknown
  }
}

export type AuvikTenantResource = {
  type: string
  id: string
  attributes: {
    domainPrefix: string
    tenantType: string | null
    name?: string
    displayName?: string
    clientName?: string
    siteName?: string
    tenantName?: string
  }
  relationships?: {
    parent?: { data?: { id: string; type?: string } | null }
  }
}

export type AuvikTenantsResponse = {
  data: readonly AuvikTenantResource[]
  next: string | null
}

export type AuvikApiRequestPolicy = {
  maxAttempts?: number
  baseDelayMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export type AuvikDeviceListInput = {
  region: string
  credentials: AuvikApiCredentials
  tenantId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  maxPages?: number
  requestPolicy?: AuvikApiRequestPolicy
}

export class AuvikApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AuvikApiError'
  }
}

export class AuvikRegionRedirectError extends AuvikApiError {
  constructor(
    readonly location: string | null,
    readonly redirectedRegion: string | null,
  ) {
    super(
      'Auvik reports that this connection belongs to another region.',
      308,
      false,
    )
    this.name = 'AuvikRegionRedirectError'
  }
}

function clean(value: string) {
  return value.normalize('NFKC').trim()
}

export function auvikApiBaseUrl(region: string) {
  const normalized = clean(region).toLocaleLowerCase('en-US')
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error(
      'Auvik region must contain only letters, numbers, and hyphens.',
    )
  }
  return new URL(`https://auvikapi.${normalized}.my.auvik.com/`)
}

export function auvikBasicAuthorization(credentials: AuvikApiCredentials) {
  const username = clean(credentials.username)
  const apiKey = clean(credentials.apiKey)
  if (!username || !apiKey) {
    throw new Error('Auvik username and API key are required.')
  }

  return `Basic ${Buffer.from(`${username}:${apiKey}`, 'utf8').toString(
    'base64',
  )}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDevicePage(value: unknown): AuvikDeviceV2Page {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new AuvikApiError(
      'Auvik returned an invalid Device API response.',
      502,
      false,
    )
  }

  const data = value.data.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.type !== 'string' ||
      !isRecord(candidate.attributes)
    ) {
      throw new AuvikApiError(
        'Auvik returned an invalid device resource.',
        502,
        false,
      )
    }

    return candidate as AuvikDeviceV2Resource
  })

  const links = isRecord(value.links)
    ? {
        ...value.links,
        next:
          typeof value.links.next === 'string' || value.links.next === null
            ? value.links.next
            : undefined,
      }
    : undefined

  return { data, links }
}

function parseTenantsResponse(value: unknown): AuvikTenantsResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new AuvikApiError(
      'Auvik returned an invalid Tenants API response.',
      502,
      false,
    )
  }

  const data = value.data.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.type !== 'string' ||
      !isRecord(candidate.attributes) ||
      typeof candidate.attributes.domainPrefix !== 'string'
    ) {
      throw new AuvikApiError(
        'Auvik returned an invalid tenant resource.',
        502,
        false,
      )
    }
    const optionalNames = ['name', 'displayName', 'clientName', 'siteName', 'tenantName'] as const
    const names: Partial<Record<(typeof optionalNames)[number], string>> = {}
    for (const key of optionalNames) {
      const value = candidate.attributes[key]
      if (typeof value === 'string' && value.trim()) names[key] = value.trim()
    }
    const parentRelationship = isRecord(candidate.relationships)
      ? candidate.relationships.parent : null
    const parent = isRecord(parentRelationship) && isRecord(parentRelationship.data)
      && typeof parentRelationship.data.id === 'string'
      ? { id: parentRelationship.data.id }
      : null
    return {
      type: candidate.type,
      id: candidate.id,
      attributes: {
        domainPrefix: candidate.attributes.domainPrefix,
        tenantType:
          typeof candidate.attributes.tenantType === 'string'
            ? candidate.attributes.tenantType
            : null,
        ...names,
      },
      ...(parent ? { relationships: { parent: { data: parent } } } : {}),
    }
  })

  const next = isRecord(value.links) && typeof value.links.next === 'string'
    ? value.links.next
    : null
  return { data, next }
}

function safeNextUrl(next: string, baseUrl: URL) {
  const candidate = new URL(next, baseUrl)
  if (
    candidate.protocol !== 'https:' ||
    candidate.hostname !== baseUrl.hostname
  ) {
    throw new AuvikApiError(
      'Auvik returned an unsafe pagination URL outside the configured API host.',
      502,
      false,
    )
  }
  return candidate
}

export function auvikRegionFromRedirect(
  location: string | null,
): string | null {
  if (!location) return null
  let candidate: URL
  try {
    candidate = new URL(location)
  } catch {
    return null
  }
  if (candidate.protocol !== 'https:') return null
  const match = candidate.hostname.match(
    /^auvikapi\.([a-z0-9-]+)\.my\.auvik\.com$/i,
  )
  return match?.[1]?.toLocaleLowerCase('en-US') ?? null
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function retryDelayMs(attempt: number, baseDelayMs: number) {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 30_000)
}

async function auvikGet(input: {
  url: URL
  baseUrl: URL
  credentials: AuvikApiCredentials
  fetchImpl: typeof fetch
  signal?: AbortSignal
  requestPolicy?: AuvikApiRequestPolicy
}) {
  const maxAttempts = input.requestPolicy?.maxAttempts ?? 3
  const baseDelayMs = input.requestPolicy?.baseDelayMs ?? 500
  const sleep = input.requestPolicy?.sleep ?? defaultSleep

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('Auvik maxAttempts must be an integer between 1 and 10.')
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new Error('Auvik baseDelayMs must be zero or greater.')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await input.fetchImpl(input.url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: auvikBasicAuthorization(input.credentials),
      },
      redirect: 'manual',
      signal: input.signal,
    })

    if (response.status === 308) {
      const location = response.headers.get('location')
      throw new AuvikRegionRedirectError(
        location,
        auvikRegionFromRedirect(location),
      )
    }

    if (response.ok) return response

    const retryable = response.status === 429 || response.status >= 500
    const retryInClient = response.status >= 500
    if (!retryInClient || attempt >= maxAttempts) {
      throw new AuvikApiError(
        `Auvik API request failed with HTTP ${response.status}.`,
        response.status,
        retryable,
      )
    }

    await sleep(retryDelayMs(attempt, baseDelayMs))
  }

  throw new AuvikApiError('Auvik API request failed.', 502, false)
}

async function fetchDevicePage(input: {
  url: URL
  baseUrl: URL
  credentials: AuvikApiCredentials
  fetchImpl: typeof fetch
  signal?: AbortSignal
  requestPolicy?: AuvikApiRequestPolicy
}) {
  const response = await auvikGet(input)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new AuvikApiError(
      'Auvik returned an invalid JSON response.',
      502,
      false,
    )
  }

  const page = parseDevicePage(payload)
  return {
    ...page,
    nextUrl:
      typeof page.links?.next === 'string'
        ? safeNextUrl(page.links.next, input.baseUrl)
        : null,
  }
}

export async function verifyAuvikCredentials(input: {
  region: string
  credentials: AuvikApiCredentials
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: AuvikApiRequestPolicy
}) {
  const baseUrl = auvikApiBaseUrl(input.region)
  const url = new URL(AUVIK_VERIFY_CREDENTIALS_PATH, baseUrl)
  await auvikGet({
    url,
    baseUrl,
    credentials: input.credentials,
    fetchImpl: input.fetchImpl ?? fetch,
    signal: input.signal,
    requestPolicy: input.requestPolicy,
  })
  return { ok: true as const }
}

export async function listAuvikTenants(input: {
  region: string
  credentials: AuvikApiCredentials
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: AuvikApiRequestPolicy
}) {
  const baseUrl = auvikApiBaseUrl(input.region)
  const tenants = new Map<string, AuvikTenantResource>()
  const seenUrls = new Set<string>()
  let url: URL | null = new URL(AUVIK_TENANTS_PATH, baseUrl)

  // Auvik tenants may be returned on several JSON:API pages. Never silently
  // drop later pages or send credentials to an untrusted pagination host.
  for (let page = 0; url; page += 1) {
    if (page >= 100 || seenUrls.has(url.href)) {
      throw new AuvikApiError('Auvik tenant discovery exceeded its pagination safety limit.', 502, false)
    }
    seenUrls.add(url.href)
    const response = await auvikGet({
      url,
      baseUrl,
      credentials: input.credentials,
      fetchImpl: input.fetchImpl ?? fetch,
      signal: input.signal,
      requestPolicy: input.requestPolicy,
    })

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AuvikApiError('Auvik returned an invalid JSON response.', 502, false)
    }
    const parsed = parseTenantsResponse(payload)
    for (const tenant of parsed.data) {
      // Preserve the first occurrence of each durable Auvik tenant identity.
      if (!tenants.has(tenant.id)) tenants.set(tenant.id, tenant)
    }
    url = parsed.next ? safeNextUrl(parsed.next, baseUrl) : null
  }
  return [...tenants.values()]
}

/**
 * Retrieve human-readable tenant metadata and parent relationships.
 * The Auvik Tenant Details API requires the primary MSP domain prefix,
 * which is different from a tenant ID. This endpoint returns all descendants.
 */
export async function listAuvikTenantDetails(input: {
  region: string
  credentials: AuvikApiCredentials
  tenantDomainPrefix: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: AuvikApiRequestPolicy
}) {
  if (!input.tenantDomainPrefix.trim()) {
    throw new Error('Auvik tenant details require a primary tenant domain prefix.')
  }
  const baseUrl = auvikApiBaseUrl(input.region)
  const firstUrl = new URL(AUVIK_TENANT_DETAILS_PATH, baseUrl)
  firstUrl.searchParams.set('tenantDomainPrefix', input.tenantDomainPrefix.trim())
  const seenUrls = new Set<string>()
  const tenants = new Map<string, AuvikTenantResource>()
  let url: URL | null = firstUrl
  for (let page = 0; url; page += 1) {
    if (page >= 100 || seenUrls.has(url.href)) {
      throw new AuvikApiError('Auvik tenant details exceeded their pagination safety limit.', 502, false)
    }
    seenUrls.add(url.href)
    const response = await auvikGet({
      url, baseUrl, credentials: input.credentials,
      fetchImpl: input.fetchImpl ?? fetch,
      signal: input.signal, requestPolicy: input.requestPolicy,
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AuvikApiError('Auvik returned invalid tenant details JSON.', 502, false)
    }
    const parsed = parseTenantsResponse(payload)
    for (const tenant of parsed.data) tenants.set(tenant.id, tenant)
    url = parsed.next ? safeNextUrl(parsed.next, baseUrl) : null
  }
  return [...tenants.values()]
}

/**
 * Fetch all Device API v2 pages for one Auvik tenant.
 *
 * Auvik Device API v2 scopes the list endpoint to one tenant. Callers that
 * intentionally sync multiple tenants should fan out at the integration layer
 * and keep tenant context attached to each returned record.
 */
export async function listAuvikDevicesV2(input: AuvikDeviceListInput) {
  const baseUrl = auvikApiBaseUrl(input.region)
  const tenantId = clean(input.tenantId)
  if (!tenantId) throw new Error('Auvik tenant ID is required.')

  const firstUrl = new URL(AUVIK_DEVICE_V2_PATH, baseUrl)
  firstUrl.searchParams.set('tenant', tenantId)
  firstUrl.searchParams.set(
    'page[first]',
    String(AUVIK_DEVICE_V2_PAGE_SIZE),
  )

  const fetchImpl = input.fetchImpl ?? fetch
  const maxPages = input.maxPages ?? 100
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('Auvik maxPages must be a positive integer.')
  }

  const devices: AuvikDeviceV2Resource[] = []
  let url: URL | null = firstUrl

  for (let pageNumber = 1; url; pageNumber += 1) {
    if (pageNumber > maxPages) {
      throw new AuvikApiError(
        `Auvik Device API exceeded the configured ${maxPages}-page safety limit.`,
        502,
        false,
      )
    }

    const page = await fetchDevicePage({
      url,
      baseUrl,
      credentials: input.credentials,
      fetchImpl,
      signal: input.signal,
      requestPolicy: input.requestPolicy,
    })
    devices.push(...page.data)
    url = page.nextUrl
  }

  return devices
}
