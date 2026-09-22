import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

describe('Firmware catalog observed-release publication', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let workspace: typeof import('./importer-v2-workspace-store')
  let publication: typeof import('./importer-v2-publication-store')

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    db = (await import('./prisma')).prisma
    workspace = await import('./importer-v2-workspace-store')
    publication = await import('./importer-v2-publication-store')
  }, 120000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }
  }, 120000)

  it('creates one Needs-review canonical release, reuses it, and preserves raw evidence', async () => {
    const provider = 'FirmwareCatalog106'
    const sourceAdapterId = 'firmware-catalog-106'
    const customer = await db.customer.create({
      data: { code: 'FW106-CUSTOMER', name: 'Firmware 106 Customer' },
    })
    const site = await db.site.create({
      data: { customerId: customer.id, name: 'Firmware 106 Site' },
    })
    const vendor = await db.vendor.create({
      data: { code: 'ARUBA', name: 'Aruba Test' },
    })
    const deviceType = await db.deviceType.create({
      data: { code: 'FW106-SWITCH', name: 'Firmware 106 Switch' },
    })
    const model = await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: 'Firmware 106 Model',
        platform: 'AOS-S',
      },
    })

    async function publish(sourceId: string, serialNumber: string, rowNumber: number) {
      const batch = await workspace.stageImporterV2Workspace({
        name: `${sourceId}.xlsx`,
        provider,
        sourceAdapterId,
        profileId: 'firmware-106-profile',
        profileVersion: '1',
        evaluationFingerprint: randomUUID(),
        rows: [
          {
            rowNumber,
            sourceFingerprint: `fingerprint-${sourceId}`,
            inclusion: 'INCLUDED',
            statuses: ['VALID', 'NEW'],
            primaryStatus: 'VALID',
            repeatClassification: 'NEW',
            issueCount: 0,
            hasErrors: false,
            sourceName: sourceId,
            hostname: sourceId,
            customer: customer.name,
            site: site.name,
            vendor: vendor.name,
            deviceType: deviceType.name,
            sourceModel: model.model,
            canonicalModel: model.model,
            softwarePlatform: 'AOS-S',
            rawFirmwareVersion: 'WC.16.11.0014',
            rawSoftwareVersion: 'WC.16.11.0014',
            interpretedFirmware: 'WC.16.11.0014',
            confidence: 'HIGH',
            evaluated: {
              rawValues: {
                customer: customer.name,
                site: site.name,
                deviceName: sourceId,
                hostname: sourceId,
                sourceId,
                serialNumber,
                vendor: vendor.name,
                deviceType: deviceType.name,
                model: model.model,
                softwarePlatform: 'AOS-S',
                firmwareVersion: 'WC.16.11.0014',
                softwareVersion: 'WC.16.11.0014',
              },
              proposedCanonicalValues: {
                customer: { id: customer.id, label: customer.name },
                site: { id: site.id, label: site.name },
                vendor: { id: vendor.id, label: vendor.name },
                deviceType: { id: deviceType.id, label: deviceType.name },
                model: { id: model.id, label: model.model },
                softwarePlatform: { id: null, label: 'AOS-S' },
                currentFirmware: { id: null, label: 'WC.16.11.0014' },
              },
              fields: {},
              issues: [],
              firmware: {
                interpreterId: 'test-firmware-interpreter',
                interpreterVersion: '1',
                runningVersion: 'WC.16.11.0014',
                compatibility: { status: 'COMPATIBLE' },
                warnings: [],
              },
            },
            identityResolution: {
              kind: 'NEW',
              requiresConfirmation: false,
              candidates: [],
              options: ['CREATE_NEW'],
              explanation: 'New deterministic source identity.',
            },
            repeatDiff: null,
          },
        ],
      })

      const qa = await publication.getImporterV2PublicationQa(batch.id)
      expect(qa.catalogProposals).toEqual([
        expect.objectContaining({
          field: 'currentFirmware',
          label: 'WC.16.11.0014',
        }),
      ])

      return publication.publishImporterV2Batch({
        batchId: batch.id,
        mode: 'ALL_RESOLVED',
        qaFingerprint: qa.qaFingerprint,
        idempotencyKey: randomUUID(),
        // #106: deterministic observed firmware no longer needs a separate
        // catalog-creation approval. It is created as Needs review instead.
        approvedProposalKeys: [],
      })
    }

    const first = await publish('fw106-device-1', 'FW106-SERIAL-1', 2)
    const second = await publish('fw106-device-2', 'FW106-SERIAL-2', 3)
    expect(first.publishedRows).toHaveLength(1)
    expect(second.publishedRows).toHaveLength(1)

    const releases = await db.firmwareRelease.findMany({
      where: {
        vendorId: vendor.id,
        platform: 'AOS-S',
        version: 'WC.16.11.0014',
      },
    })
    expect(releases).toHaveLength(1)
    expect(releases[0]).toMatchObject({
      logicalVersion: '16.11.0014',
      imageCode: 'WC',
      catalogState: 'OBSERVED',
      policyEligibility: 'NOT_EVALUATED',
      status: 'AVAILABLE',
      source: 'IMPORT',
      externalProvider: provider,
      firmwareTrainId: null,
    })

    const devices = await db.device.findMany({
      where: { id: { in: first.publishedRows.concat(second.publishedRows).map((row) => row.canonicalDeviceId) } },
      orderBy: { name: 'asc' },
      select: {
        currentFirmwareReleaseId: true,
        currentFirmwareRawVersion: true,
        currentFirmwareEvidence: true,
      },
    })
    expect(devices).toHaveLength(2)
    for (const device of devices) {
      expect(device.currentFirmwareReleaseId).toBe(releases[0].id)
      expect(device.currentFirmwareRawVersion).toBe('WC.16.11.0014')
      expect(device.currentFirmwareEvidence).toMatchObject({
        rawFirmwareVersion: 'WC.16.11.0014',
        rawSoftwareVersion: 'WC.16.11.0014',
      })
    }
  }, 120000)
})
