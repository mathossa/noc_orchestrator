import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

describe('Importer v2 PostgreSQL 12,000-row publication', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let workspace: typeof import('./importer-v2-workspace-store')
  let publication: typeof import('./importer-v2-publication-store')
  let batchId: string
  const timings: Record<string, number> = {}

  async function measure<T>(phase: string, run: () => Promise<T>) {
    const start = performance.now()
    const result = await run()
    timings[phase] = performance.now() - start
    return result
  }

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    workspace = await import('./importer-v2-workspace-store')
    publication = await import('./importer-v2-publication-store')

    const customer = await db.customer.create({
      data: { code: 'PERF-CUSTOMER', name: 'Performance Customer' },
    })
    const site = await db.site.create({
      data: { customerId: customer.id, name: 'Performance Site' },
    })
    const vendor = await db.vendor.create({
      data: { code: 'PERF-VENDOR', name: 'Performance Vendor' },
    })
    const deviceType = await db.deviceType.create({
      data: { code: 'PERF-SWITCH', name: 'Performance Switch' },
    })
    const model = await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: 'Performance Model',
        platform: 'IOS-XE',
      },
    })
    const release = await db.firmwareRelease.create({
      data: {
        vendorId: vendor.id,
        platform: 'IOS-XE',
        version: '17.12.5',
        logicalVersion: '17.12.5',
      },
    })

    const rows = Array.from({ length: 12000 }, (_, index) => {
      const rowNumber = index + 1
      const name = `perf-device-${String(rowNumber).padStart(5, '0')}`
      const sourceId = `perf-source-${rowNumber}`
      const serialNumber = `PERF-SERIAL-${rowNumber}`

      return {
        rowNumber,
        sourceFingerprint: `publication-${rowNumber}`,
        inclusion: 'INCLUDED' as const,
        statuses: ['VALID', 'NEW'],
        primaryStatus: 'VALID',
        repeatClassification: 'NEW' as const,
        issueCount: 0,
        hasErrors: false,
        sourceName: name,
        customer: customer.name,
        site: site.name,
        vendor: vendor.name,
        deviceType: deviceType.name,
        sourceModel: model.model,
        canonicalModel: model.model,
        softwarePlatform: 'IOS-XE',
        rawFirmwareVersion: release.version,
        rawSoftwareVersion: release.version,
        interpretedFirmware: release.version,
        confidence: 'HIGH',
        evaluated: {
          rawValues: {
            customer: customer.name,
            site: site.name,
            deviceName: name,
            sourceId,
            serialNumber,
            vendor: vendor.name,
            deviceType: deviceType.name,
            model: model.model,
            softwarePlatform: 'IOS-XE',
            firmwareVersion: release.version,
            softwareVersion: release.version,
          },
          proposedCanonicalValues: {
            customer: { id: customer.id, label: customer.name },
            site: { id: site.id, label: site.name },
            vendor: { id: vendor.id, label: vendor.name },
            deviceType: { id: deviceType.id, label: deviceType.name },
            model: { id: model.id, label: model.model },
            softwarePlatform: { id: null, label: 'IOS-XE' },
            currentFirmware: { id: release.id, label: release.version },
          },
          fields: {
            currentFirmware: {
              decision: { source: 'EXACT_CATALOG_MATCH' },
            },
            model: {
              decision: { source: 'EXACT_CATALOG_MATCH' },
            },
          },
          issues: [],
          firmware: {
            compatibility: { status: 'COMPATIBLE' },
            warnings: [],
          },
        },
        identityResolution: {
          kind: 'NEW',
          requiresConfirmation: false,
          candidates: [],
          options: ['CREATE_NEW'],
          explanation: 'Synthetic publication performance device.',
        },
        repeatDiff: null,
      }
    })

    const batch = await measure('publication stage database', () =>
      workspace.stageImporterV2Workspace({
        name: `issue52-publication-${randomUUID()}`,
        provider: 'SyntheticCMDB',
        sourceAdapterId: 'synthetic-publication',
        profileId: 'performance-publication',
        profileVersion: '1',
        evaluationFingerprint: randomUUID(),
        rows,
      }),
    )
    batchId = batch.id
  }, 120000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()

      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl

      console.info(
        'Importer v2 publication timings (ms):',
        JSON.stringify(timings),
      )
    }
  }, 120000)

  it('publishes 12,000 resolved rows atomically within the 30s budget', async () => {
    const qa = await measure('publication QA', () =>
      publication.getImporterV2PublicationQa(batchId),
    )

    expect(qa.publication.unresolvedRows).toHaveLength(0)
    expect(qa.publication.allResolvedCandidateRows).toHaveLength(12000)
    expect(qa.catalogProposals).toHaveLength(0)

    const result = await measure('atomic publication', () =>
      publication.publishImporterV2Batch({
        batchId,
        mode: 'ALL_RESOLVED',
        qaFingerprint: qa.qaFingerprint,
        idempotencyKey: `performance-${randomUUID()}`,
        approvedProposalKeys: [],
      }),
    )

    expect(result.publishedLogicalDeviceCount).toBe(12000)
    expect(result.publishedRowCount).toBe(12000)
    expect(result.remainingIncludedRows).toBe(0)
    expect(result.batchStatus).toBe('PUBLISHED')

    expect(
      await db.device.count({
        where: { externalProvider: 'SyntheticCMDB' },
      }),
    ).toBe(12000)
    expect(
      await db.importerV2DeviceCrosswalk.count({
        where: { provider: 'SyntheticCMDB' },
      }),
    ).toBe(12000)
    expect(
      await db.importerV2WorkspaceRow.count({
        where: { batchId, publishedAt: { not: null } },
      }),
    ).toBe(12000)

    expect(timings['atomic publication']).toBeLessThanOrEqual(30000)
  }, 180000)
})
