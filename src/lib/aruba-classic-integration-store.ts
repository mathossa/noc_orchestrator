import { randomUUID } from 'node:crypto'
import { discoverSitesFromClassicDeviceEvidence } from '@/lib/aruba-classic-site-discovery'
import { prisma } from '@/lib/prisma'
import {
  ArubaCentralApiError,
  arubaCentralApiBaseUrl,
  type ArubaCentralClassicConfiguration,
} from '@/lib/aruba-central-api-client'
import {
  refreshClassicCentralAccessToken,
  listClassicCentralSites,
  listClassicCentralDevices,
  type ClassicCentralClientCredentials,
  type ClassicCentralTokens,
} from '@/lib/aruba-classic-central-api-client'
import {
  encryptInventorySourceSecret,
  decryptInventorySourceSecret,
  INVENTORY_SOURCE_SECRET_ALGORITHM,
  INVENTORY_SOURCE_SECRET_KEY_VERSION,
} from '@/lib/inventory-source-secret-crypto'
import { loadInventorySourceSecret } from '@/lib/inventory-source-secret-store'
import { ARUBA_CENTRAL_PROVIDER } from '@/lib/importer-v2-aruba-central'
import { ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE } from '@/lib/aruba-classic-central-api-client'

export type ClassicCentralSiteScope = {
  /** Stable site ID from Central (Classic API usually reports a number). */
  siteId?: string | null
  siteName: string
  enabled: boolean
  site: string | null
}

export type ClassicCentralConnectionConfiguration = {
  version: 1
  scopeMode: 'SELECTED_SITES'
  variant: 'CLASSIC'
  baseUrl: string
  customer: string | null
  businessUnit: string | null
  sites: readonly ClassicCentralSiteScope[]
}
export type StoredClassicCentralCredentials = ClassicCentralClientCredentials & ClassicCentralTokens

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') ?? ''
}
export function normalizeClassicCentralConnectionConfiguration(input: {
  baseUrl: string
  customer?: string | null
  businessUnit?: string | null
  sites?: readonly ClassicCentralSiteScope[]
  scopeMode?: 'SELECTED_SITES' | 'ALL_DEVICES'
}): ClassicCentralConnectionConfiguration {
  const baseUrl = arubaCentralApiBaseUrl({ variant: 'CLASSIC', baseUrl: clean(input.baseUrl) }).origin
  // Legacy ALL_DEVICES configurations are read as selected-only, but
  // new requests may not re-enable whole-tenant publication.
  if (input.scopeMode && input.scopeMode !== 'SELECTED_SITES') {
    throw new Error('Aruba Classic inventory must use explicitly selected sites.')
  }
  const sites = (input.sites ?? []).map((scope) => {
    const siteName = clean(scope.siteName)
    if (!siteName) throw new Error('Each Classic Central site must have a name.')
    return {
      siteId: clean(scope.siteId) || null,
      siteName,
      enabled: scope.enabled === true,
      site: clean(scope.site) || null,
    }
  })
  if (new Set(sites.map((site) => site.siteName.toLowerCase())).size !== sites.length) {
    throw new Error('Duplicate Classic Central site scope.')
  }
  return {
    version: 1, variant: 'CLASSIC', baseUrl, scopeMode: 'SELECTED_SITES',
    customer: clean(input.customer) || null,
    businessUnit: clean(input.businessUnit) || null,
    sites,
  }
}
function parseConfiguration(value: unknown) {
  const item = value as Partial<ClassicCentralConnectionConfiguration> | null
  if (!item || item.version !== 1 || item.variant !== 'CLASSIC' || !item.baseUrl) {
    throw new Error('Classic Central connection configuration is invalid.')
  }
  return normalizeClassicCentralConnectionConfiguration({
    baseUrl: item.baseUrl, customer: item.customer, businessUnit: item.businessUnit,
    sites: Array.isArray(item.sites) ? item.sites : [],
    scopeMode: item.scopeMode === 'ALL_DEVICES' ? undefined : item.scopeMode,
  })
}
function validateCredentials(value: StoredClassicCentralCredentials) {
  const result = {
    clientId: clean(value.clientId),
    clientSecret: clean(value.clientSecret),
    accessToken: clean(value.accessToken),
    refreshToken: clean(value.refreshToken),
  }
  if (Object.values(result).some((field) => !field)) {
    throw new Error('Classic Central client ID, client secret, access token and refresh token are required.')
  }
  return result
}
function connectionTest(value: unknown) {
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  return {
    status: metadata.lastConnectionTestStatus === 'SUCCESS' || metadata.lastConnectionTestStatus === 'FAILED'
      ? metadata.lastConnectionTestStatus as 'SUCCESS' | 'FAILED' : 'UNTESTED' as const,
    testedAt: typeof metadata.lastConnectionTestAt === 'string' ? metadata.lastConnectionTestAt : null,
    httpStatus: typeof metadata.lastConnectionTestHttpStatus === 'number' ? metadata.lastConnectionTestHttpStatus : null,
  }
}
function publicConnection(record: {
  id: string; provider: string; adapterType: string; sourceAdapterId: string
  name: string; enabled: boolean; configuration: unknown; metadata: unknown
  createdAt: Date; updatedAt: Date; secret: {sourceId: string} | null
}) {
  if (record.provider !== ARUBA_CENTRAL_PROVIDER ||
    record.adapterType !== ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE) {
    throw new Error('Inventory source is not a Classic Central connection.')
  }
  return {
    id: record.id, provider: record.provider, adapterType: record.adapterType,
    sourceAdapterId: record.sourceAdapterId, name: record.name, enabled: record.enabled,
    configuration: parseConfiguration(record.configuration),
    credentialsConfigured: Boolean(record.secret),
    connectionTest: connectionTest(record.metadata),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
  }
}
export async function createClassicCentralConnection(input: {
  name: string
  baseUrl: string
  customer?: string | null
  businessUnit?: string | null
  sites?: readonly ClassicCentralSiteScope[]
  scopeMode?: 'SELECTED_SITES' | 'ALL_DEVICES'
  credentials: StoredClassicCentralCredentials
}) {
  const name = clean(input.name)
  if (!name) throw new Error('Aruba connection name is required.')
  const config = normalizeClassicCentralConnectionConfiguration(input)
  const credentials = validateCredentials(input.credentials)
  const sourceId = randomUUID()
  const envelope = encryptInventorySourceSecret(sourceId, credentials)
  const record = await prisma.$transaction(async (tx) => {
    const source = await tx.inventorySource.create({
      data: {
        id: sourceId, provider: ARUBA_CENTRAL_PROVIDER,
        adapterType: ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE,
        sourceAdapterId: `${ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE}:${sourceId}`,
        name, enabled: false, configuration: config as never,
        metadata: { connectionType: 'ARUBA_CENTRAL_CLASSIC', lastConnectionTestStatus: 'UNTESTED' },
      },
    })
    await tx.inventorySourceSecret.create({ data: { sourceId, ...envelope } })
    return { ...source, secret: { sourceId } }
  })
  return publicConnection(record)
}
export async function listClassicCentralConnections() {
  const records = await prisma.inventorySource.findMany({
    where: { provider: ARUBA_CENTRAL_PROVIDER, adapterType: ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE },
    include: { secret: { select: { sourceId: true } } },
    orderBy: [{name:'asc'},{id:'asc'}],
  })
  return records.map(publicConnection)
}
export async function getClassicCentralConnection(sourceId: string) {
  const record = await prisma.inventorySource.findUnique({
    where: {id:sourceId}, include: {secret: {select:{sourceId:true}}},
  })
  if (!record || record.provider !== ARUBA_CENTRAL_PROVIDER ||
    record.adapterType !== ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE) return null
  return publicConnection(record)
}
export async function getClassicCentralConnectionCredentials(sourceId: string) {
  const connection = await getClassicCentralConnection(sourceId)
  if (!connection) throw new Error('Classic Central connection was not found.')
  const loaded = await loadInventorySourceSecret<StoredClassicCentralCredentials>(sourceId)
  if (!loaded) throw new Error('Classic Central credentials are not configured.')
  return {connection,credentials:validateCredentials(loaded)}
}
export async function updateClassicCentralConnection(input: {
  sourceId: string; name?: string; baseUrl?: string
  customer?: string | null; businessUnit?: string | null
  sites?: readonly ClassicCentralSiteScope[]; enabled?: boolean
  scopeMode?: 'SELECTED_SITES' | 'ALL_DEVICES'
  credentials?: StoredClassicCentralCredentials
}) {
  const existing = await getClassicCentralConnection(input.sourceId)
  if (!existing) throw new Error('Classic Central connection was not found.')
  const config = normalizeClassicCentralConnectionConfiguration({
    baseUrl: input.baseUrl ?? existing.configuration.baseUrl,
    customer: input.customer === undefined ? existing.configuration.customer : input.customer,
    businessUnit: input.businessUnit === undefined ? existing.configuration.businessUnit : input.businessUnit,
    sites: input.sites ?? existing.configuration.sites,
    scopeMode: input.scopeMode ?? existing.configuration.scopeMode,
  })
  const name = input.name === undefined ? existing.name : clean(input.name)
  if (!name) throw new Error('Aruba connection name is required.')
  const willEnable = input.enabled ?? existing.enabled
  if (willEnable && !config.customer) {
    throw new Error('Choose a customer for this Classic Central connection before enabling sync.')
  }
  if (willEnable && !config.sites.some((site) => site.enabled)) {
    throw new Error('Select and save at least one Classic Central site before enabling sync.')
  }
  const identityChanged = config.baseUrl !== existing.configuration.baseUrl || Boolean(input.credentials)
  if (input.enabled === true && (identityChanged || existing.connectionTest.status !== 'SUCCESS')) {
    throw new Error('Save credentials/gateway and pass a new connection test before enabling sync.')
  }
  const envelope = input.credentials
    ? encryptInventorySourceSecret(input.sourceId,validateCredentials(input.credentials))
    : null
  const record = await prisma.$transaction(async (tx) => {
    const source = await tx.inventorySource.update({
      where:{id:input.sourceId},
      data:{
        name, enabled: identityChanged ? false : (input.enabled ?? existing.enabled),
        configuration:config as never,
        ...(identityChanged ? {metadata:{connectionType:'ARUBA_CENTRAL_CLASSIC',lastConnectionTestStatus:'UNTESTED'}} : {}),
      },
    })
    if (envelope) await tx.inventorySourceSecret.upsert({
      where:{sourceId:input.sourceId},
      create:{sourceId:input.sourceId,...envelope},
      update:{...envelope},
    })
    return {...source,secret:{sourceId:source.id}}
  })
  return publicConnection(record)
}
/**
 * Serialize local credential persistence with row locks and compare the
 * expected refresh token to reject stale writes after concurrent rotation.
 * This protects the saved secret without exposing token content in errors.
 */
export async function persistClassicCentralRotatedTokens(
  sourceId: string, expectedRefreshToken: string, rotated: ClassicCentralTokens,
) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{id:string}>>`
      SELECT "id" FROM "InventorySource" WHERE "id" = ${sourceId} FOR UPDATE
    `
    if (locked.length === 0) throw new Error('Classic Central connection was not found.')
    const saved = await tx.inventorySourceSecret.findUnique({where:{sourceId}})
    if (!saved) throw new Error('Classic Central credentials are not configured.')
    if (saved.algorithm !== INVENTORY_SOURCE_SECRET_ALGORITHM || saved.keyVersion !== INVENTORY_SOURCE_SECRET_KEY_VERSION) {
      throw new Error('Unsupported Classic Central credential encryption.')
    }
    const current = decryptInventorySourceSecret<StoredClassicCentralCredentials>(sourceId,{
      algorithm:INVENTORY_SOURCE_SECRET_ALGORITHM,
      keyVersion:INVENTORY_SOURCE_SECRET_KEY_VERSION,
      initializationVector:saved.initializationVector,
      authenticationTag:saved.authenticationTag,
      ciphertext:saved.ciphertext,
    })
    if (current.refreshToken !== expectedRefreshToken) {
      throw new Error('Classic Central credentials changed during token renewal; retry sync.')
    }
    const envelope = encryptInventorySourceSecret(sourceId,validateCredentials({...current,...rotated}))
    await tx.inventorySourceSecret.update({where:{sourceId},data:{...envelope}})
  })
}
/**
 * Do not make Classic refresh a prerequisite for every device read:
 * refresh just before initial expiration and when needed on 401. Callers
 * pass this helper to the Classic API client to persist token rotation.
 */
export async function classicCentralRefreshContext(sourceId:string, credentials:StoredClassicCentralCredentials) {
  let lastRefreshToken = credentials.refreshToken
  return {
    credentials:{clientId:credentials.clientId,clientSecret:credentials.clientSecret},
    refreshToken:lastRefreshToken,
    onTokensRotated:async (tokens:ClassicCentralTokens) => {
      await persistClassicCentralRotatedTokens(sourceId,lastRefreshToken,tokens)
      lastRefreshToken = tokens.refreshToken
    },
  }
}
export async function testClassicCentralConnection(
  sourceId:string, options:{fetchImpl?:typeof fetch;signal?:AbortSignal}={},
) {
  const {connection,credentials}=await getClassicCentralConnectionCredentials(sourceId)
  const testedAt=new Date().toISOString()
  try {
    // A fresh Classic OAuth refresh validates gateway, API application and
    // credential permissions while also extending the refresh token lifetime.
    const tokens=await refreshClassicCentralAccessToken({
      configuration:connection.configuration as ArubaCentralClassicConfiguration,
      credentials,
      refreshToken:credentials.refreshToken,
      fetchImpl:options.fetchImpl,
      signal:options.signal,
    })
    await persistClassicCentralRotatedTokens(sourceId,credentials.refreshToken,tokens)
    // A token-only response is not enough: verify the connection can read
    // site inventory with the same API gateway used by device monitoring.
    await listClassicCentralSites({
      configuration: connection.configuration,
      accessToken: tokens.accessToken,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    })
    await prisma.inventorySource.update({
      where:{id:sourceId},
      data:{metadata:{connectionType:'ARUBA_CENTRAL_CLASSIC',lastConnectionTestStatus:'SUCCESS',lastConnectionTestAt:testedAt}},
    })
    return {ok:true as const}
  } catch(error) {
    const status=error instanceof ArubaCentralApiError ? error.status : null
    await prisma.inventorySource.update({
      where:{id:sourceId},
      data:{metadata:{connectionType:'ARUBA_CENTRAL_CLASSIC',lastConnectionTestStatus:'FAILED',lastConnectionTestAt:testedAt,lastConnectionTestHttpStatus:status}},
    })
    throw error
  }
}

/** Optional non-MSP discovery: one Classic Central account belongs to one customer.
 * Do not reinterpret Aruba groups as physical sites; when the site catalog is
 * empty, the monitoring observations can still contain genuine site names.
 * This only fetches on an explicit operator request, never every scheduled sync.
 */
export async function discoverClassicCentralSites(
  sourceId: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  await testClassicCentralConnection(sourceId, options)
  const { connection, credentials } = await getClassicCentralConnectionCredentials(sourceId)
  const catalog = await listClassicCentralSites({
    configuration: connection.configuration,
    accessToken: credentials.accessToken,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  })
  if (catalog.length > 0) {
    return {
      sites: catalog.map(site => ({ ...site, origin: 'SITE_CATALOG' as const })),
      catalogCount: catalog.length,
      observedDeviceCount: null,
      unassignedDeviceCount: null,
      observedGroupCount: null,
    }
  }

  const observations = await listClassicCentralDevices({
    configuration: connection.configuration,
    accessToken: credentials.accessToken,
    refresh: await classicCentralRefreshContext(sourceId, credentials),
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  })
  return {
    ...discoverSitesFromClassicDeviceEvidence(observations),
    catalogCount: 0,
  }
}
