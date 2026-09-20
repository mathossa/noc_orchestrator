import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'
import { diffImporterV2RepeatImport } from './importer-v2-repeat-diff'

describe('Importer v2 PostgreSQL repeat publication', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let workspace: typeof import('./importer-v2-workspace-store')
  let publication: typeof import('./importer-v2-publication-store')
  let identityStore: typeof import('./importer-v2-identity-store')

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    workspace = await import('./importer-v2-workspace-store')
    publication = await import('./importer-v2-publication-store')
    identityStore = await import('./importer-v2-identity-store')
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

  it('updates source-owned values while protecting manual canonical values', async () => {
    const provider = 'RepeatCMDB'
    const sourceAdapterId = 'repeat-xlsx'
    const sourceId = 'repeat-source-1'
    const serialNumber = 'REPEAT-SERIAL-1'

    const customer = await db.customer.create({
      data: { code: 'REPEAT-CUSTOMER', name: 'Repeat Customer' },
    })
    const site = await db.site.create({
      data: { customerId: customer.id, name: 'Repeat Site' },
    })
    const vendor = await db.vendor.create({
      data: { code: 'REPEAT-VENDOR', name: 'Repeat Vendor' },
    })
    const deviceType = await db.deviceType.create({
      data: { code: 'REPEAT-SWITCH', name: 'Repeat Switch' },
    })
    const model = await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: 'Repeat Model',
        platform: 'IOS-XE',
      },
    })
    const oldRelease = await db.firmwareRelease.create({
      data: {
        vendorId: vendor.id,
        platform: 'IOS-XE',
        version: '17.12.5',
        logicalVersion: '17.12.5',
      },
    })
    const newRelease = await db.firmwareRelease.create({
      data: {
        vendorId: vendor.id,
        platform: 'IOS-XE',
        version: '17.15.4',
        logicalVersion: '17.15.4',
      },
    })

    const firstBatch = await workspace.stageImporterV2Workspace({
      name: 'repeat-initial.xlsx',
      provider,
      sourceAdapterId,
      profileId: 'repeat-profile',
      profileVersion: '1',
      evaluationFingerprint: randomUUID(),
      rows: [
        {
          rowNumber: 2,
          sourceFingerprint: 'repeat-initial-row',
          inclusion: 'INCLUDED',
          statuses: ['VALID', 'NEW'],
          primaryStatus: 'VALID',
          repeatClassification: 'NEW',
          issueCount: 0,
          hasErrors: false,
          sourceName: 'repeat-device',
          hostname: 'source-host-1',
          customer: customer.name,
          site: site.name,
          vendor: vendor.name,
          deviceType: deviceType.name,
          sourceModel: model.model,
          canonicalModel: model.model,
          softwarePlatform: 'IOS-XE',
          rawFirmwareVersion: oldRelease.version,
          rawSoftwareVersion: oldRelease.version,
          interpretedFirmware: oldRelease.version,
          confidence: 'HIGH',
          evaluated: {
            rawValues: {
              customer: customer.name,
              site: site.name,
              deviceName: 'repeat-device',
              hostname: 'source-host-1',
              managementAddress: '10.0.0.1',
              sourceId,
              serialNumber,
              vendor: vendor.name,
              deviceType: deviceType.name,
              model: model.model,
              softwarePlatform: 'IOS-XE',
              firmwareVersion: oldRelease.version,
              softwareVersion: oldRelease.version,
            },
            proposedCanonicalValues: {
              customer: { id: customer.id, label: customer.name },
              site: { id: site.id, label: site.name },
              vendor: { id: vendor.id, label: vendor.name },
              deviceType: { id: deviceType.id, label: deviceType.name },
              model: { id: model.id, label: model.model },
              softwarePlatform: { id: null, label: 'IOS-XE' },
              currentFirmware: { id: oldRelease.id, label: oldRelease.version },
            },
            fields: {},
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
            explanation: 'Initial source device.',
          },
          repeatDiff: null,
        },
      ],
    })

    const firstQa = await publication.getImporterV2PublicationQa(firstBatch.id)
    const firstResult = await publication.publishImporterV2Batch({
      batchId: firstBatch.id,
      mode: 'ALL_RESOLVED',
      qaFingerprint: firstQa.qaFingerprint,
      idempotencyKey: randomUUID(),
      approvedProposalKeys: [],
    })
    const canonicalDeviceId = firstResult.publishedRows[0]?.canonicalDeviceId
    expect(canonicalDeviceId).toBeTruthy()

    await db.device.update({
      where: { id: canonicalDeviceId },
      data: { hostname: 'manual-hostname' },
    })

    const latest = await identityStore.getLatestSuccessfulImporterV2SourceSnapshot({
      provider,
      sourceAdapterId,
    })
    expect(latest?.rows).toHaveLength(1)

    const canonicalDevice = await db.device.findUniqueOrThrow({
      where: { id: canonicalDeviceId },
      select: {
        name: true,
        hostname: true,
        managementAddress: true,
        currentFirmwareRawVersion: true,
      },
    })

    const currentValues = {
      customer: customer.name,
      site: site.name,
      deviceName: 'repeat-device',
      hostname: 'source-host-2',
      managementAddress: '10.0.0.2',
      sourceId,
      serialNumber,
      vendor: vendor.name,
      deviceType: deviceType.name,
      model: model.model,
      softwarePlatform: 'IOS-XE',
      currentFirmware: newRelease.version,
      firmwareVersion: newRelease.version,
      softwareVersion: newRelease.version,
    }

    const repeat = diffImporterV2RepeatImport({
      previousRows: latest?.rows ?? [],
      currentRows: [
        {
          rowNumber: 2,
          canonicalDeviceId,
          identityStatus: 'MATCHED',
          identifiers: { sourceId, serialNumber },
          values: currentValues,
          canonicalValues: {
            deviceName: canonicalDevice.name,
            hostname: canonicalDevice.hostname,
            managementAddress: canonicalDevice.managementAddress,
            currentFirmware: canonicalDevice.currentFirmwareRawVersion,
          },
        },
      ],
      isFullInventoryExport: false,
    })

    const repeatItem = repeat.items[0]
    expect(repeatItem?.classification).toBe('CHANGED')
    expect(
      repeatItem?.proposals.find((proposal) => proposal.field === 'hostname'),
    ).toMatchObject({
      allowed: false,
      reason: 'MANUAL_VALUE_PROTECTED',
    })
    expect(
      repeatItem?.proposals.find(
        (proposal) => proposal.field === 'managementAddress',
      ),
    ).toMatchObject({
      allowed: true,
      reason: 'SOURCE_OWNED_VALUE',
    })
    expect(
      repeatItem?.proposals.find(
        (proposal) => proposal.field === 'currentFirmware',
      ),
    ).toMatchObject({
      allowed: true,
      reason: 'OBSERVED_CURRENT_FIRMWARE',
    })

    const secondBatch = await workspace.stageImporterV2Workspace({
      name: 'repeat-second.xlsx',
      provider,
      sourceAdapterId,
      profileId: 'repeat-profile',
      profileVersion: '1',
      evaluationFingerprint: randomUUID(),
      rows: [
        {
          rowNumber: 2,
          sourceFingerprint: 'repeat-second-row',
          inclusion: 'INCLUDED',
          statuses: ['VALID', 'CHANGED'],
          primaryStatus: 'VALID',
          repeatClassification: 'CHANGED',
          issueCount: 0,
          hasErrors: false,
          sourceName: 'repeat-device',
          hostname: 'source-host-2',
          customer: customer.name,
          site: site.name,
          vendor: vendor.name,
          deviceType: deviceType.name,
          sourceModel: model.model,
          canonicalModel: model.model,
          softwarePlatform: 'IOS-XE',
          rawFirmwareVersion: newRelease.version,
          rawSoftwareVersion: newRelease.version,
          interpretedFirmware: newRelease.version,
          confidence: 'HIGH',
          evaluated: {
            rawValues: {
              customer: customer.name,
              site: site.name,
              deviceName: 'repeat-device',
              hostname: 'source-host-2',
              managementAddress: '10.0.0.2',
              sourceId,
              serialNumber,
              vendor: vendor.name,
              deviceType: deviceType.name,
              model: model.model,
              softwarePlatform: 'IOS-XE',
              firmwareVersion: newRelease.version,
              softwareVersion: newRelease.version,
            },
            proposedCanonicalValues: {
              customer: { id: customer.id, label: customer.name },
              site: { id: site.id, label: site.name },
              vendor: { id: vendor.id, label: vendor.name },
              deviceType: { id: deviceType.id, label: deviceType.name },
              model: { id: model.id, label: model.model },
              softwarePlatform: { id: null, label: 'IOS-XE' },
              currentFirmware: { id: newRelease.id, label: newRelease.version },
            },
            fields: {},
            issues: [],
            firmware: {
              compatibility: { status: 'COMPATIBLE' },
              warnings: [],
            },
          },
          identityResolution: {
            kind: 'MATCH_SUGGESTED',
            requiresConfirmation: false,
            candidates: [
              {
                canonicalDeviceId,
                confidence: 'HIGH',
                evidence: ['SOURCE_ID', 'SERIAL'],
                signals: [],
                contextDifferences: [],
              },
            ],
            options: ['CONFIRM_MATCH'],
            explanation: 'Matched through durable source identity.',
          },
          repeatDiff: repeatItem,
        },
      ],
    })

    const secondQa = await publication.getImporterV2PublicationQa(secondBatch.id)
    expect(secondQa.publication.unresolvedRows).toHaveLength(0)

    const secondResult = await publication.publishImporterV2Batch({
      batchId: secondBatch.id,
      mode: 'ALL_RESOLVED',
      qaFingerprint: secondQa.qaFingerprint,
      idempotencyKey: randomUUID(),
      approvedProposalKeys: [],
    })

    expect(secondResult.publishedRows).toEqual([
      expect.objectContaining({
        canonicalDeviceId,
        action: 'UPDATE',
      }),
    ])

    const updated = await db.device.findUniqueOrThrow({
      where: { id: canonicalDeviceId },
      select: {
        hostname: true,
        managementAddress: true,
        currentFirmwareReleaseId: true,
        currentFirmwareRawVersion: true,
      },
    })

    expect(updated.hostname).toBe('manual-hostname')
    expect(updated.managementAddress).toBe('10.0.0.2')
    expect(updated.currentFirmwareReleaseId).toBe(newRelease.id)
    expect(updated.currentFirmwareRawVersion).toBe(newRelease.version)
  }, 120000)
})
