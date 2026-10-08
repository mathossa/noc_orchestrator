import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  auvikRegionFromRedirect,
  AuvikRegionRedirectError,
  listAuvikTenants,
  verifyAuvikCredentials,
  type AuvikApiCredentials,
} from '@/lib/auvik-api-client'
import {
  encryptInventorySourceSecret,
  INVENTORY_SOURCE_SECRET_ALGORITHM,
  INVENTORY_SOURCE_SECRET_KEY_VERSION,
} from '@/lib/inventory-source-secret-crypto'
import { loadInventorySourceSecret } from '@/lib/inventory-source-secret-store'
import {
  AUVIK_API_PROVIDER,
  AUVIK_API_V2_ADAPTER_TYPE,
  type AuvikImporterV2TenantContext,
} from '@/lib/importer-v2-auvik-api'

export type AuvikInventoryTenantScope = AuvikImporterV2TenantContext

export type AuvikInventoryConnectionConfiguration = {
  version: 1
  region: string
  tenants: readonly AuvikInventoryTenantScope[]
}

type AuvikStoredCredentials = {
  username: string
  apiKey: string
}

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function normalizeRegion(value: string) {
  const region = clean(value)?.toLocaleLowerCase('en-US')
  if (!region || !/^[a-z0-9-]+$/.test(region)) {
    throw new Error(
      'Auvik region must contain only letters, numbers, and hyphens.',
    )
  }
  return region
}

function normalizeTenantScope(
  value: AuvikInventoryTenantScope,
): AuvikInventoryTenantScope {
  const tenantId = clean(value.tenantId)
  if (!tenantId) throw new Error('Every Auvik tenant scope requires a tenant ID.')
  return {
    enabled: value.enabled !== false,
    tenantId,
    tenantName: clean(value.tenantName),
    customer: clean(value.customer),
    businessUnit: clean(value.businessUnit),
    site: clean(value.site),
  }
}

export function normalizeAuvikConnectionConfiguration(input: {
  region: string
  tenants?: readonly AuvikInventoryTenantScope[]
}): AuvikInventoryConnectionConfiguration {
  const tenants = (input.tenants ?? []).map(normalizeTenantScope)
  if (new Set(tenants.map((tenant) => tenant.tenantId)).size !== tenants.length) {
    throw new Error('Each Auvik tenant may appear only once in a connection.')
  }
  return {
    version: 1,
    region: normalizeRegion(input.region),
    tenants,
  }
}

function parseConfiguration(value: unknown): AuvikInventoryConnectionConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Auvik connection configuration is invalid.')
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.region !== 'string') {
    throw new Error('Auvik connection configuration is invalid.')
  }
  const tenants = Array.isArray(record.tenants)
    ? record.tenants.map((tenant) => {
        if (!tenant || typeof tenant !== 'object' || Array.isArray(tenant)) {
          throw new Error('Auvik tenant scope is invalid.')
        }
        const item = tenant as Record<string, unknown>
        return normalizeTenantScope({
          enabled: item.enabled !== false,
          tenantId: typeof item.tenantId === 'string' ? item.tenantId : '',
          tenantName:
            typeof item.tenantName === 'string' ? item.tenantName : null,
          customer: typeof item.customer === 'string' ? item.customer : null,
          businessUnit:
            typeof item.businessUnit === 'string' ? item.businessUnit : null,
          site: typeof item.site === 'string' ? item.site : null,
        })
      })
    : []

  return normalizeAuvikConnectionConfiguration({
    region: record.region,
    tenants,
  })
}

function cleanCredentials(input: AuvikApiCredentials): AuvikStoredCredentials {
  const username = input.username.normalize('NFKC').trim()
  const apiKey = input.apiKey.trim()
  if (!username || !apiKey) {
    throw new Error('Auvik username and API key are required.')
  }
  return { username, apiKey }
}

type AuvikConnectionTestMetadata = {
  status: 'UNTESTED' | 'SUCCESS' | 'FAILED'
  testedAt: string | null
  httpStatus: number | null
  suggestedRegion: string | null
}

function testMetadata(value: unknown): AuvikConnectionTestMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      status: 'UNTESTED',
      testedAt: null,
      httpStatus: null,
      suggestedRegion: null,
    }
  }
  const record = value as Record<string, unknown>
  const status =
    record.lastConnectionTestStatus === 'SUCCESS' ||
    record.lastConnectionTestStatus === 'FAILED'
      ? record.lastConnectionTestStatus
      : 'UNTESTED'
  return {
    status,
    testedAt:
      typeof record.lastConnectionTestAt === 'string'
        ? record.lastConnectionTestAt
        : null,
    httpStatus:
      typeof record.lastConnectionTestHttpStatus === 'number'
        ? record.lastConnectionTestHttpStatus
        : null,
    suggestedRegion:
      typeof record.suggestedRegion === 'string'
        ? record.suggestedRegion
        : null,
  }
}

function publicConnection(record: {
  id: string
  provider: string
  adapterType: string
  sourceAdapterId: string
  name: string
  enabled: boolean
  configuration: unknown
  createdAt: Date
  updatedAt: Date
  metadata: unknown
  secret: { sourceId: string } | null
}) {
  if (
    record.provider !== AUVIK_API_PROVIDER ||
    record.adapterType !== AUVIK_API_V2_ADAPTER_TYPE
  ) {
    throw new Error('Inventory source is not an Auvik API v2 connection.')
  }
  return {
    id: record.id,
    name: record.name,
    enabled: record.enabled,
    provider: record.provider,
    adapterType: record.adapterType,
    sourceAdapterId: record.sourceAdapterId,
    configuration: parseConfiguration(record.configuration),
    credentialsConfigured: Boolean(record.secret),
    connectionTest: testMetadata(record.metadata),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function createAuvikInventoryConnection(input: {
  name: string
  region: string
  credentials: AuvikApiCredentials
  tenants?: readonly AuvikInventoryTenantScope[]
  enabled?: boolean
}) {
  const name = clean(input.name)
  if (!name) throw new Error('Auvik connection name is required.')
  const configuration = normalizeAuvikConnectionConfiguration({
    region: input.region,
    tenants: input.tenants,
  })
  const credentials = cleanCredentials(input.credentials)
  const sourceId = randomUUID()
  const sourceAdapterId = `${AUVIK_API_V2_ADAPTER_TYPE}:${sourceId}`
  const envelope = encryptInventorySourceSecret(sourceId, credentials)

  const record = await prisma.$transaction(async (tx) => {
    const source = await tx.inventorySource.create({
      data: {
        id: sourceId,
        provider: AUVIK_API_PROVIDER,
        adapterType: AUVIK_API_V2_ADAPTER_TYPE,
        sourceAdapterId,
        name,
        enabled: input.enabled ?? false,
        configuration: configuration as never,
        metadata: {
          connectionType: 'AUVIK_API_V2',
          lastConnectionTestStatus: 'UNTESTED',
        },
      },
    })
    await tx.inventorySourceSecret.create({
      data: {
        sourceId,
        algorithm: envelope.algorithm,
        keyVersion: envelope.keyVersion,
        initializationVector: envelope.initializationVector,
        authenticationTag: envelope.authenticationTag,
        ciphertext: envelope.ciphertext,
      },
    })
    return {
      ...source,
      secret: { sourceId },
    }
  })

  return publicConnection(record)
}

export async function listAuvikInventoryConnections() {
  const records = await prisma.inventorySource.findMany({
    where: {
      provider: AUVIK_API_PROVIDER,
      adapterType: AUVIK_API_V2_ADAPTER_TYPE,
    },
    include: {
      secret: { select: { sourceId: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  return records.map(publicConnection)
}

export async function getAuvikInventoryConnection(sourceId: string) {
  const record = await prisma.inventorySource.findUnique({
    where: { id: sourceId },
    include: {
      secret: { select: { sourceId: true } },
    },
  })
  return record ? publicConnection(record) : null
}

export async function getAuvikInventoryConnectionCredentials(
  sourceId: string,
) {
  const connection = await getAuvikInventoryConnection(sourceId)
  if (!connection) throw new Error('Auvik connection was not found.')
  const credentials =
    await loadInventorySourceSecret<AuvikStoredCredentials>(sourceId)
  if (!credentials) throw new Error('Auvik credentials are not configured.')
  return { connection, credentials }
}

export async function updateAuvikInventoryConnection(input: {
  sourceId: string
  name?: string
  region?: string
  tenants?: readonly AuvikInventoryTenantScope[]
  enabled?: boolean
  credentials?: AuvikApiCredentials | null
}) {
  const existing = await getAuvikInventoryConnection(input.sourceId)
  if (!existing) throw new Error('Auvik connection was not found.')

  const configuration = normalizeAuvikConnectionConfiguration({
    region: input.region ?? existing.configuration.region,
    tenants: input.tenants ?? existing.configuration.tenants,
  })
  const name =
    input.name === undefined ? existing.name : clean(input.name)
  if (!name) throw new Error('Auvik connection name is required.')
  const credentials = input.credentials
    ? cleanCredentials(input.credentials)
    : null
  const envelope = credentials
    ? encryptInventorySourceSecret(input.sourceId, credentials)
    : null

  const changesConnectionIdentity =
    configuration.region !== existing.configuration.region || Boolean(input.credentials)
  if (
    input.enabled === true &&
    existing.connectionTest.status !== 'SUCCESS' &&
    !changesConnectionIdentity
  ) {
    throw new Error(
      'Test the Auvik connection successfully before enabling synchronization.',
    )
  }
  if (input.enabled === true && changesConnectionIdentity) {
    throw new Error(
      'Save changed Auvik credentials/region, test the connection, then enable synchronization.',
    )
  }

  const record = await prisma.$transaction(async (tx) => {
    const source = await tx.inventorySource.update({
      where: { id: input.sourceId },
      data: {
        name,
        enabled: changesConnectionIdentity
          ? false
          : (input.enabled ?? existing.enabled),
        configuration: configuration as never,
        ...(changesConnectionIdentity
          ? {
              metadata: {
                connectionType: 'AUVIK_API_V2',
                lastConnectionTestStatus: 'UNTESTED',
              },
            }
          : {}),
      },
    })
    if (envelope) {
      await tx.inventorySourceSecret.upsert({
        where: { sourceId: input.sourceId },
        create: {
          sourceId: input.sourceId,
          algorithm: envelope.algorithm,
          keyVersion: envelope.keyVersion,
          initializationVector: envelope.initializationVector,
          authenticationTag: envelope.authenticationTag,
          ciphertext: envelope.ciphertext,
        },
        update: {
          algorithm: envelope.algorithm,
          keyVersion: envelope.keyVersion,
          initializationVector: envelope.initializationVector,
          authenticationTag: envelope.authenticationTag,
          ciphertext: envelope.ciphertext,
        },
      })
    }
    return {
      ...source,
      secret: { sourceId: source.id },
    }
  })

  return publicConnection(record)
}

export async function testAuvikInventoryConnection(
  sourceId: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  } = {},
) {
  const { connection, credentials } =
    await getAuvikInventoryConnectionCredentials(sourceId)
  const testedAt = new Date().toISOString()
  try {
    await verifyAuvikCredentials({
      region: connection.configuration.region,
      credentials,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    })
    await prisma.inventorySource.update({
      where: { id: sourceId },
      data: {
        metadata: {
          connectionType: 'AUVIK_API_V2',
          lastConnectionTestStatus: 'SUCCESS',
          lastConnectionTestAt: testedAt,
        },
      },
    })
    return {
      ok: true as const,
      region: connection.configuration.region,
      suggestedRegion: null,
    }
  } catch (error) {
    if (error instanceof AuvikRegionRedirectError) {
      const suggestedRegion =
        error.redirectedRegion ?? auvikRegionFromRedirect(error.location)
      await prisma.inventorySource.update({
        where: { id: sourceId },
        data: {
          metadata: {
            connectionType: 'AUVIK_API_V2',
            lastConnectionTestStatus: 'FAILED',
            lastConnectionTestAt: testedAt,
            lastConnectionTestHttpStatus: error.status,
            suggestedRegion,
          },
        },
      })
      return {
        ok: false as const,
        region: connection.configuration.region,
        suggestedRegion,
        error: error.message,
        status: error.status,
      }
    }

    const status =
      error &&
      typeof error === 'object' &&
      'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : null
    await prisma.inventorySource.update({
      where: { id: sourceId },
      data: {
        metadata: {
          connectionType: 'AUVIK_API_V2',
          lastConnectionTestStatus: 'FAILED',
          lastConnectionTestAt: testedAt,
          lastConnectionTestHttpStatus: status,
        },
      },
    })
    throw error
  }
}

export async function discoverAuvikInventoryTenants(
  sourceId: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  } = {},
) {
  const { connection, credentials } =
    await getAuvikInventoryConnectionCredentials(sourceId)
  if (connection.connectionTest.status !== 'SUCCESS') {
    throw new Error(
      'Test the Auvik connection successfully before discovering tenants.',
    )
  }
  return listAuvikTenants({
    region: connection.configuration.region,
    credentials,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  })
}

export const AUVIK_INVENTORY_SECRET_ALGORITHM =
  INVENTORY_SOURCE_SECRET_ALGORITHM
export const AUVIK_INVENTORY_SECRET_KEY_VERSION =
  INVENTORY_SOURCE_SECRET_KEY_VERSION
