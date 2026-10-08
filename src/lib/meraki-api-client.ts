export const MERAKI_ORGANIZATIONS_PATH = '/organizations'
export const MERAKI_PAGE_SIZE = 1000

export type MerakiApiEnvironment =
  | 'global'
  | 'canada'
  | 'china'
  | 'india'
  | 'fedramp'

export type MerakiApiCredentials = {
  apiKey: string
}

export type MerakiOrganization = {
  id: string
  name: string
  url?: string | null
}

export type MerakiNetwork = {
  id: string
  organizationId: string
  name: string
  productTypes?: readonly string[] | null
  tags?: readonly string[] | null
  timeZone?: string | null
  url?: string | null
}

export type MerakiDevice = {
  name?: string | null
  networkId: string
  serial: string
  model: string
  mac?: string | null
  lanIp?: string | null
  firmware?: string | null
  productType?: string | null
  tags?: readonly string[] | null
  details?: readonly { name?: string | null; value?: string | null }[] | null
  [key: string]: unknown
}

export type MerakiApiRequestPolicy = {
  maxAttempts?: number
  baseDelayMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export class MerakiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'MerakiApiError'
  }
}

const MERAKI_API_BASE_URLS: Record<MerakiApiEnvironment, string> = {
  global: 'https://api.meraki.com/api/v1/',
  canada: 'https://api.meraki.ca/api/v1/',
  china: 'https://api.meraki.cn/api/v1/',
  india: 'https://api.meraki.in/api/v1/',
  fedramp: 'https://api.gov-meraki.com/api/v1/',
}

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim() ?? ''
}

export function merakiApiBaseUrl(environment: MerakiApiEnvironment) {
  const value = MERAKI_API_BASE_URLS[environment]
  if (!value) throw new Error('Unsupported Meraki API environment.')
  return new URL(value)
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function retryDelayMs(attempt: number, baseDelayMs: number) {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 30_000)
}

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function nextLink(header: string | null, baseUrl: URL) {
  if (!header) return null
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
    if (!match) continue
    const url = new URL(match[1], baseUrl)
    if (url.protocol !== 'https:' || url.origin !== baseUrl.origin) {
      throw new MerakiApiError(
        'Meraki returned an unsafe pagination URL outside the configured API host.',
        502,
        false,
      )
    }
    return url
  }
  return null
}

async function merakiGet(input: {
  url: URL
  baseUrl: URL
  credentials: MerakiApiCredentials
  fetchImpl: typeof fetch
  signal?: AbortSignal
  requestPolicy?: MerakiApiRequestPolicy
}) {
  const apiKey = clean(input.credentials.apiKey)
  if (!apiKey) throw new Error('Meraki API key is required.')

  const maxAttempts = input.requestPolicy?.maxAttempts ?? 4
  const baseDelayMs = input.requestPolicy?.baseDelayMs ?? 500
  const sleep = input.requestPolicy?.sleep ?? defaultSleep
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('Meraki maxAttempts must be an integer between 1 and 10.')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await input.fetchImpl(input.url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: 'error',
      signal: input.signal,
    })

    if (response.ok) return response

    const retryAfter = retryAfterSeconds(response)
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= maxAttempts) {
      throw new MerakiApiError(
        `Meraki Dashboard API request failed with HTTP ${response.status}.`,
        response.status,
        retryable,
        retryAfter,
      )
    }

    const delay =
      response.status === 429 && retryAfter !== null
        ? retryAfter * 1000
        : retryDelayMs(attempt, baseDelayMs)
    await sleep(delay)
  }

  throw new MerakiApiError('Meraki Dashboard API request failed.', 502, false)
}

async function jsonArray<T>(
  response: Response,
  label: string,
): Promise<T[]> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MerakiApiError(
      `Meraki returned invalid JSON for ${label}.`,
      502,
      false,
    )
  }
  if (!Array.isArray(payload)) {
    throw new MerakiApiError(
      `Meraki returned an invalid ${label} response.`,
      502,
      false,
    )
  }
  return payload as T[]
}

async function paginatedGet<T>(input: {
  url: URL
  baseUrl: URL
  credentials: MerakiApiCredentials
  fetchImpl: typeof fetch
  signal?: AbortSignal
  requestPolicy?: MerakiApiRequestPolicy
  label: string
  maxPages?: number
}) {
  const maxPages = input.maxPages ?? 1000
  const rows: T[] = []
  let url: URL | null = input.url

  for (let page = 1; url; page += 1) {
    if (page > maxPages) {
      throw new MerakiApiError(
        `Meraki ${input.label} pagination exceeded the configured ${maxPages}-page safety limit.`,
        502,
        false,
      )
    }
    const response = await merakiGet({
      url,
      baseUrl: input.baseUrl,
      credentials: input.credentials,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
      requestPolicy: input.requestPolicy,
    })
    rows.push(...(await jsonArray<T>(response, input.label)))
    url = nextLink(response.headers.get('link'), input.baseUrl)
  }

  return rows
}

export async function listMerakiOrganizations(input: {
  environment: MerakiApiEnvironment
  credentials: MerakiApiCredentials
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: MerakiApiRequestPolicy
}) {
  const baseUrl = merakiApiBaseUrl(input.environment)
  const response = await merakiGet({
    url: new URL(MERAKI_ORGANIZATIONS_PATH.slice(1), baseUrl),
    baseUrl,
    credentials: input.credentials,
    fetchImpl: input.fetchImpl ?? fetch,
    signal: input.signal,
    requestPolicy: input.requestPolicy,
  })
  return jsonArray<MerakiOrganization>(response, 'organizations')
}

export async function listMerakiOrganizationNetworks(input: {
  environment: MerakiApiEnvironment
  credentials: MerakiApiCredentials
  organizationId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: MerakiApiRequestPolicy
}) {
  const baseUrl = merakiApiBaseUrl(input.environment)
  const organizationId = encodeURIComponent(clean(input.organizationId))
  if (!organizationId) throw new Error('Meraki organization ID is required.')
  const url = new URL(`organizations/${organizationId}/networks`, baseUrl)
  url.searchParams.set('perPage', String(MERAKI_PAGE_SIZE))
  return paginatedGet<MerakiNetwork>({
    url,
    baseUrl,
    credentials: input.credentials,
    fetchImpl: input.fetchImpl ?? fetch,
    signal: input.signal,
    requestPolicy: input.requestPolicy,
    label: 'organization networks',
  })
}

export async function listMerakiOrganizationDevices(input: {
  environment: MerakiApiEnvironment
  credentials: MerakiApiCredentials
  organizationId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: MerakiApiRequestPolicy
}) {
  const baseUrl = merakiApiBaseUrl(input.environment)
  const organizationId = encodeURIComponent(clean(input.organizationId))
  if (!organizationId) throw new Error('Meraki organization ID is required.')
  const url = new URL(`organizations/${organizationId}/devices`, baseUrl)
  url.searchParams.set('perPage', String(MERAKI_PAGE_SIZE))
  return paginatedGet<MerakiDevice>({
    url,
    baseUrl,
    credentials: input.credentials,
    fetchImpl: input.fetchImpl ?? fetch,
    signal: input.signal,
    requestPolicy: input.requestPolicy,
    label: 'organization devices',
  })
}
