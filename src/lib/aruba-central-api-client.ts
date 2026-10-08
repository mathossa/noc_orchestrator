/**
 * HPE Aruba Networking Central (New Central) REST client.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * New Central and Classic Central have different authentication and inventory
 * APIs. Never fall back between the two products silently.
 *
 * Docs:
 * https://developer.arubanetworks.com/new-central/docs/generating-and-managing-access-tokens
 * https://developer.arubanetworks.com/new-central/reference/getdevicesv1
 */
export type ArubaCentralVariant = 'NEW' | 'CLASSIC'

export type ArubaCentralNewCredentials = {
  clientId: string
  clientSecret: string
}

export type ArubaCentralNewConfiguration = {
  variant: 'NEW'
  /** Copy this from Central -> API Gateway -> REST API. */
  baseUrl: string
}

export type ArubaCentralClassicConfiguration = {
  variant: 'CLASSIC'
  baseUrl: string
}

export type ArubaCentralConfiguration =
  | ArubaCentralNewConfiguration
  | ArubaCentralClassicConfiguration

export type ArubaCentralDevice = {
  id?: string | null
  serialNumber?: string | null
  deviceName?: string | null
  hostname?: string | null
  macAddress?: string | null
  model?: string | null
  deviceType?: string | null
  ipv4?: string | null
  siteId?: string | null
  siteName?: string | null
  deviceGroupId?: string | null
  deviceGroupName?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
  deployment?: string | null
  status?: string | null
  [key: string]: unknown
}

const CLASSIC_CENTRAL_GATEWAY_HOSTS = new Set([
  'app1-apigw.central.arubanetworks.com',
  'apigw-prod2.central.arubanetworks.com',
  'apigw-us-east-1.central.arubanetworks.com',
  'apigw-uswest4.central.arubanetworks.com',
  'apigw-uswest5.central.arubanetworks.com',
  'eu-apigw.central.arubanetworks.com',
  'apigw-eucentral2.central.arubanetworks.com',
  'apigw-eucentral3.central.arubanetworks.com',
  'apigw-ca.central.arubanetworks.com',
  'apigw.central.arubanetworks.com.cn',
  'api-ap.central.arubanetworks.com',
  'apigw-apaceast.central.arubanetworks.com',
  'apigw-apacsouth.central.arubanetworks.com',
  'apigw-uaenorth1.central.arubanetworks.com',
])

export const ARUBA_NEW_CENTRAL_TOKEN_URL =
  'https://sso.common.cloud.hpe.com/as/token.oauth2'
export const ARUBA_NEW_CENTRAL_DEVICES_PATH =
  '/network-monitoring/v1/devices'
export const ARUBA_NEW_CENTRAL_PAGE_SIZE = 1000

export class ArubaCentralApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ArubaCentralApiError'
  }
}

export type RequestPolicy = {
  maxAttempts?: number
  sleep?: (milliseconds: number) => Promise<void>
  baseDelayMs?: number
}

type NewCentralRequestInput = {
  configuration: ArubaCentralNewConfiguration
  credentials: ArubaCentralNewCredentials
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: RequestPolicy
}

export type NewCentralListDevicesInput = NewCentralRequestInput & {
  maxPages?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clean(value: string) {
  return value.normalize('NFKC').trim()
}

/** Restrict bearer-token destinations to documented Central API gateway hosts. */
export function arubaCentralApiBaseUrl(configuration: ArubaCentralConfiguration): URL {
  let url: URL
  try {
    url = new URL(configuration.baseUrl)
  } catch {
    throw new Error('Aruba Central API base URL is invalid.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Aruba Central API base URL must be an HTTPS gateway origin.')
  }
  const hostname = url.hostname.toLowerCase()
  if (configuration.variant === 'NEW') {
    // The account-specific gateway is available from Central's API Gateway UI.
    if (
      !/^[a-z0-9-]+\.api\.central\.arubanetworks\.com(?:\.cn)?$/.test(hostname) ||
      hostname.startsWith('internal.')
    ) {
      throw new Error('New Central requires a documented Central REST API gateway host.')
    }
  } else if (configuration.variant === 'CLASSIC') {
    if (!CLASSIC_CENTRAL_GATEWAY_HOSTS.has(hostname)) {
      throw new Error('Classic Central requires its own API Gateway URL.')
    }
  } else {
    throw new Error('Unknown Aruba Central API variant.')
  }
  return url
}

function validateNewCentralCredentials(credentials: ArubaCentralNewCredentials) {
  if (!clean(credentials.clientId) || !clean(credentials.clientSecret)) {
    throw new Error('New Central client ID and client secret are required.')
  }
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function policyValues(policy?: RequestPolicy) {
  const attempts = policy?.maxAttempts ?? 3
  const baseDelayMs = policy?.baseDelayMs ?? 500
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error('Aruba Central maxAttempts must be between 1 and 10.')
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new Error('Aruba Central baseDelayMs must be non-negative.')
  }
  return {
    attempts,
    baseDelayMs,
    sleep: policy?.sleep ?? defaultSleep,
  }
}

function retryDelay(response: Response, attempt: number, baseDelayMs: number) {
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(60_000, seconds * 1000)
    }
  }
  return Math.min(30_000, baseDelayMs * 2 ** (attempt - 1))
}

export async function requestWithRetry(input: {
  url: URL
  fetchImpl: typeof fetch
  init: RequestInit
  requestPolicy?: RequestPolicy
}) {
  const { attempts, baseDelayMs, sleep } = policyValues(input.requestPolicy)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await input.fetchImpl(input.url, {
      ...input.init,
      redirect: 'manual',
    })
    if (response.ok) return response
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === attempts) {
      throw new ArubaCentralApiError(
        `Aruba Central API request failed with HTTP ${response.status}.`,
        response.status,
        retryable,
      )
    }
    await sleep(retryDelay(response, attempt, baseDelayMs))
  }
  throw new ArubaCentralApiError('Aruba Central API request failed.', 502, false)
}

export async function jsonObject(response: Response) {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new ArubaCentralApiError(
      'Aruba Central returned an invalid JSON response.',
      502,
      false,
    )
  }
  if (!isRecord(value)) {
    throw new ArubaCentralApiError(
      'Aruba Central returned an invalid object response.',
      502,
      false,
    )
  }
  return value
}

/**
 * Central-scoped client credentials: 2-hour access token, no refresh token.
 * GLP-scoped 15-minute credentials and Classic OAuth refresh tokens are
 * intentionally NOT interchangeable with this grant.
 */
export async function requestNewCentralAccessToken(input: {
  credentials: ArubaCentralNewCredentials
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  requestPolicy?: RequestPolicy
}) {
  validateNewCentralCredentials(input.credentials)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clean(input.credentials.clientId),
    client_secret: clean(input.credentials.clientSecret),
  })
  const response = await requestWithRetry({
    url: new URL(ARUBA_NEW_CENTRAL_TOKEN_URL),
    fetchImpl: input.fetchImpl ?? fetch,
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: input.signal,
    },
    requestPolicy: input.requestPolicy,
  })
  const payload = await jsonObject(response)
  const accessToken = payload.access_token
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new ArubaCentralApiError(
      'Aruba Central did not return an access token.',
      502,
      false,
    )
  }
  return accessToken
}

function parseDevicePage(value: Record<string, unknown>) {
  if (!Array.isArray(value.items)) {
    throw new ArubaCentralApiError(
      'Aruba Central returned an invalid devices page.',
      502,
      false,
    )
  }
  const devices: ArubaCentralDevice[] = value.items.map((item) => {
    if (!isRecord(item)) {
      throw new ArubaCentralApiError(
        'Aruba Central returned an invalid device record.',
        502,
        false,
      )
    }
    return item as ArubaCentralDevice
  })
  const next = value.next
  if (next != null && (typeof next !== 'string' || !next.trim())) {
    throw new ArubaCentralApiError(
      'Aruba Central returned an invalid pagination cursor.',
      502,
      false,
    )
  }
  return { devices, next: (next ?? null) as string | null }
}

/**
 * Collect all monitored devices. A failed page fails the entire collection:
 * never stage a partial tenant result as a complete inventory snapshot.
 */
export async function listNewCentralDevices(input: NewCentralListDevicesInput) {
  const baseUrl = arubaCentralApiBaseUrl(input.configuration)
  const fetchImpl = input.fetchImpl ?? fetch
  const maxPages = input.maxPages ?? 100
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('Aruba Central maxPages must be a positive integer.')
  }

  let accessToken = await requestNewCentralAccessToken({
    credentials: input.credentials,
    fetchImpl,
    signal: input.signal,
    requestPolicy: input.requestPolicy,
  })
  const devices: ArubaCentralDevice[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const url = new URL(ARUBA_NEW_CENTRAL_DEVICES_PATH, baseUrl)
    url.searchParams.set('limit', String(ARUBA_NEW_CENTRAL_PAGE_SIZE))
    if (cursor !== null) url.searchParams.set('next', cursor)

    const loadPage = () =>
      requestWithRetry({
        url,
        fetchImpl,
        init: {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          signal: input.signal,
        },
        requestPolicy: input.requestPolicy,
      })

    let response: Response
    try {
      response = await loadPage()
    } catch (error) {
      if (!(error instanceof ArubaCentralApiError) || error.status !== 401) {
        throw error
      }
      // Retry this page exactly once with a new token after 401.
      accessToken = await requestNewCentralAccessToken({
        credentials: input.credentials,
        fetchImpl,
        signal: input.signal,
        requestPolicy: input.requestPolicy,
      })
      response = await loadPage()
    }

    const page = parseDevicePage(await jsonObject(response))
    devices.push(...page.devices)
    if (page.next === null) return devices
    if (seenCursors.has(page.next)) {
      throw new ArubaCentralApiError(
        'Aruba Central returned a repeated pagination cursor.',
        502,
        false,
      )
    }
    seenCursors.add(page.next)
    cursor = page.next
  }
  throw new ArubaCentralApiError(
    `Aruba Central exceeded the ${maxPages}-page safety limit.`,
    502,
    false,
  )
}
