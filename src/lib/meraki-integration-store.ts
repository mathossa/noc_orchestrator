import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  listMerakiOrganizationNetworks,
  listMerakiOrganizations,
  type MerakiApiCredentials,
  type MerakiApiEnvironment,
} from '@/lib/meraki-api-client'
import {
  encryptInventorySourceSecret,
  INVENTORY_SOURCE_SECRET_ALGORITHM,
  INVENTORY_SOURCE_SECRET_KEY_VERSION,
} from '@/lib/inventory-source-secret-crypto'
import { loadInventorySourceSecret } from '@/lib/inventory-source-secret-store'
import {
  MERAKI_API_PROVIDER,
  MERAKI_DASHBOARD_API_ADAPTER_TYPE,
  type MerakiOrganizationScope,
} from '@/lib/importer-v2-meraki-api'

export type MerakiInventoryConnectionConfiguration = {
  version: 1
  environment: MerakiApiEnvironment
  organizations: readonly MerakiOrganizationScope[]
}

type StoredCredentials = {
  apiKey: string
}

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') ?? ''
}

function normalizeEnvironment(value: string): MerakiApiEnvironment {
  const normalized = clean(value).toLocaleLowerCase('en-US')
  if (
    normalized === 'global' ||
    normalized === 'canada' ||
    normalized === 'china' ||
    normalized === 'india' ||
    normalized === 'fedramp'
  ) {
    return normalized
  }
  throw new Error('Unsupported Meraki API environment.')
}

function normalizeConfiguration(input: {
  environment: string
  organizations?: readonly MerakiOrganizationScope[]
}): MerakiInventoryConnectionConfiguration {
  return {
    version: 1,
    environment: normalizeEnvironment(input.environment),
    organizations: (input.organizations ?? []).map((organization) => ({
      organizationId: clean(organization.organizationId),
      organizationName: clean(organization.organizationName) || null,
      customer: clean(organization.customer) || null,
      businessUnit: clean(organization.businessUnit) || null,
      networks: organization.networks.map((network) => ({
        networkId: clean(network.networkId),
        networkName: clean(network.networkName) || null,
        site: clean(network.site) || null,
      })),
    })),
  }
}

function parseConfiguration(value: unknown): MerakiInventoryConnectionConfiguration {
  const candidate = value as Partial<MerakiInventoryConnectionConfiguration> | null
  return normalizeConfiguration({
    environment: candidate?.environment ?? 'global',
    organizations: Array.isArray(candidate?.organizations)
      ? candidate.organizations
      : [],
  })
}

function testMetadata(value: unknown) {
  const metadata =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const status: 'SUCCESS' | 'FAILED' | 'UNTESTED' =
    metadata.lastConnectionTestStatus === 'SUCCESS' ||
    metadata.lastConnectionTestStatus === 'FAILED'
      ? metadata.lastConnectionTestStatus
      : 'UNTESTED'
  return {
    status,
    testedAt:
      typeof metadata.lastConnectionTestAt === 'string'
        ? metadata.lastConnectionTestAt
        : null,
    httpStatus:
      typeof metadata.lastConnectionTestHttpStatus === 'number'
        ? metadata.lastConnectionTestHttpStatus
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
  metadata: unknown
  secret?: { sourceId: string } | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: record.id,
    provider: record.provider,
    adapterType: record.adapterType,
    sourceAdapterId: record.sourceAdapterId,
    name: record.name,
    enabled: record.enabled,
    configuration: parseConfiguration(record.configuration),
    credentialsConfigured: Boolean(record.secret),
    connectionTest: testMetadata(record.metadata),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function createMerakiInventoryConnection(input: {
  name: string
  environment: string
  credentials: MerakiApiCredentials
  organizations?: readonly MerakiOrganizationScope[]
}) {
  const name = clean(input.name)
  const apiKey = clean(input.credentials.apiKey)
  if (!name) throw new Error('Meraki connection name is required.')
  if (!apiKey) throw new Error('Meraki API key is required.')
  const configuration = normalizeConfiguration(input)
  const sourceId = randomUUID()
  const sourceAdapterId = `${MERAKI_DASHBOARD_API_ADAPTER_TYPE}:${sourceId}`
  const envelope = encryptInventorySourceSecret(sourceId, { apiKey })

  const record = await prisma.$transaction(async (tx) => {
    const source = await tx.inventorySource.create({
      data: {
        id: sourceId,
        provider: MERAKI_API_PROVIDER,
        adapterType: MERAKI_DASHBOARD_API_ADAPTER_TYPE,
        sourceAdapterId,
        name,
        enabled: false,
        configuration: configuration as never,
        metadata: {
          connectionType: 'MERAKI_DASHBOARD_API_V1',
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
    return { ...source, secret: { sourceId } }
  })
  return publicConnection(record)
}

export async function listMerakiInventoryConnections() {
  const records = await prisma.inventorySource.findMany({
    where: {
      provider: MERAKI_API_PROVIDER,
      adapterType: MERAKI_DASHBOARD_API_ADAPTER_TYPE,
    },
    include: { secret: { select: { sourceId: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  return records.map(publicConnection)
}

export async function getMerakiInventoryConnection(sourceId: string) {
  const record = await prisma.inventorySource.findUnique({
    where: { id: sourceId },
    include: { secret: { select: { sourceId: true } } },
  })
  if (
    !record ||
    record.provider !== MERAKI_API_PROVIDER ||
    record.adapterType !== MERAKI_DASHBOARD_API_ADAPTER_TYPE
  ) return null
  return publicConnection(record)
}

export async function getMerakiInventoryConnectionCredentials(sourceId: string) {
  const connection = await getMerakiInventoryConnection(sourceId)
  if (!connection) throw new Error('Meraki connection was not found.')
  const credentials = await loadInventorySourceSecret<StoredCredentials>(sourceId)
  if (!credentials) throw new Error('Meraki credentials are not configured.')
  return { connection, credentials }
}

export async function updateMerakiInventoryConnection(input: {
  sourceId: string
  name?: string
  environment?: string
  organizations?: readonly MerakiOrganizationScope[]
  enabled?: boolean
  credentials?: MerakiApiCredentials
}) {
  const existing = await getMerakiInventoryConnection(input.sourceId)
  if (!existing) throw new Error('Meraki connection was not found.')
  const configuration = normalizeConfiguration({
    environment: input.environment ?? existing.configuration.environment,
    organizations: input.organizations ?? existing.configuration.organizations,
  })
  const name = input.name === undefined ? existing.name : clean(input.name)
  if (!name) throw new Error('Meraki connection name is required.')

  const changesIdentity =
    configuration.environment !== existing.configuration.environment ||
    Boolean(input.credentials)
  if (input.enabled === true && existing.connectionTest.status !== 'SUCCESS' && !changesIdentity) {
    throw new Error('Test the Meraki connection successfully before enabling synchronization.')
  }
  if (input.enabled === true && changesIdentity) {
    throw new Error('Save changed Meraki credentials/environment, test the connection, then enable synchronization.')
  }

  const replacementApiKey = input.credentials ? clean(input.credentials.apiKey) : null
  if (input.credentials && !replacementApiKey) {
    throw new Error('Meraki API key is required.')
  }
  const envelope = replacementApiKey
    ? encryptInventorySourceSecret(input.sourceId, { apiKey: replacementApiKey })
    : null

  const record = await prisma.$transaction(async (tx) => {
    const source = await tx.inventorySource.update({
      where: { id: input.sourceId },
      data: {
        name,
        enabled: changesIdentity ? false : (input.enabled ?? existing.enabled),
        configuration: configuration as never,
        ...(changesIdentity
          ? {
              metadata: {
                connectionType: 'MERAKI_DASHBOARD_API_V1',
                lastConnectionTestStatus: 'UNTESTED',
              },
            }
          : {}),
      },
    })
    if (envelope) {
      await tx.inventorySourceSecret.upsert({
        where: { sourceId: input.sourceId },
        create: { sourceId: input.sourceId, ...envelope },
        update: { ...envelope },
      })
    }
    return { ...source, secret: { sourceId: source.id } }
  })
  return publicConnection(record)
}

export async function testMerakiInventoryConnection(
  sourceId: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  const { connection, credentials } =
    await getMerakiInventoryConnectionCredentials(sourceId)
  const testedAt = new Date().toISOString()
  try {
    const organizations = await listMerakiOrganizations({
      environment: connection.configuration.environment,
      credentials,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    })
    await prisma.inventorySource.update({
      where: { id: sourceId },
      data: {
        metadata: {
          connectionType: 'MERAKI_DASHBOARD_API_V1',
          lastConnectionTestStatus: 'SUCCESS',
          lastConnectionTestAt: testedAt,
        },
      },
    })
    return { ok: true as const, organizationCount: organizations.length }
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : null
    await prisma.inventorySource.update({
      where: { id: sourceId },
      data: {
        metadata: {
          connectionType: 'MERAKI_DASHBOARD_API_V1',
          lastConnectionTestStatus: 'FAILED',
          lastConnectionTestAt: testedAt,
          lastConnectionTestHttpStatus: status,
        },
      },
    })
    throw error
  }
}

export async function discoverMerakiOrganizations(
  sourceId: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  const { connection, credentials } =
    await getMerakiInventoryConnectionCredentials(sourceId)
  if (connection.connectionTest.status !== 'SUCCESS') {
    throw new Error('Test the Meraki connection successfully before discovering organizations.')
  }
  return listMerakiOrganizations({
    environment: connection.configuration.environment,
    credentials,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  })
}

export async function discoverMerakiNetworks(
  sourceId: string,
  organizationId: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  const { connection, credentials } =
    await getMerakiInventoryConnectionCredentials(sourceId)
  if (connection.connectionTest.status !== 'SUCCESS') {
    throw new Error('Test the Meraki connection successfully before discovering networks.')
  }
  return listMerakiOrganizationNetworks({
    environment: connection.configuration.environment,
    credentials,
    organizationId,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  })
}

export const MERAKI_INVENTORY_SECRET_ALGORITHM =
  INVENTORY_SOURCE_SECRET_ALGORITHM
export const MERAKI_INVENTORY_SECRET_KEY_VERSION =
  INVENTORY_SOURCE_SECRET_KEY_VERSION
