import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

describe('Importer v2 cross-provider identity integration', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let identity: typeof import('./importer-v2-identity')
  let identityStore: typeof import('./importer-v2-identity-store')

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    identity = await import('./importer-v2-identity')
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

  it('converges Auvik ignored serial and Aruba correct serial, then reuses the Aruba Source ID', async () => {
    const suffix = randomUUID().slice(0, 8)
    const customer = await db.customer.create({
      data: { code: `XP-${suffix}`, name: `Cross Provider ${suffix}` },
    })
    const site = await db.site.create({
      data: { customerId: customer.id, name: 'Site A' },
    })
    const vendor = await db.vendor.create({
      data: { code: `ARUBA-${suffix}`, name: 'Aruba' },
    })
    const deviceType = await db.deviceType.create({
      data: { code: `AP-${suffix}`, name: 'Access Point' },
    })
    const model = await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: 'AP-515',
        platform: 'AOS-10',
      },
    })
    const ap01 = await db.device.create({
      data: {
        customerId: customer.id,
        siteId: site.id,
        deviceModelId: model.id,
        name: 'AP01',
        hostname: 'ap01.example',
        serialNumber: 'AP01-CORRECT',
      },
    })

    // The raw bad Auvik serial remains in the staged/source evidence history,
    // but the confirmed crosswalk alias is null after IGNORE_FIELD.
    await db.importerV2DeviceCrosswalk.create({
      data: {
        provider: 'AUVIK',
        sourceAdapterId: 'auvik-api-v2',
        canonicalDeviceId: ap01.id,
        sourceId: 'auvik-ap01',
        normalizedSourceId: 'auvik-ap01',
        serialNumber: null,
        normalizedSerialNumber: null,
        macAddress: null,
        normalizedMacAddress: null,
      },
    })

    const arubaIdentifiers = {
      sourceId: 'aruba-ap01',
      serialNumber: 'AP01-CORRECT',
      macAddress: null,
    }
    const firstCandidates = await identityStore.buildImporterV2IdentityCandidateResolver({
      provider: 'ARUBA',
      identifiers: [arubaIdentifiers],
    })
    const firstResolution = identity.resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-central-api-v1',
        identifiers: arubaIdentifiers,
        context: {
          customer: customer.name,
          site: site.name,
          vendor: vendor.name,
          model: model.model,
          deviceType: deviceType.name,
        },
      },
      firstCandidates(arubaIdentifiers),
    )

    expect(firstResolution).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: false,
    })
    expect(firstResolution.candidates).toEqual([
      expect.objectContaining({
        canonicalDeviceId: ap01.id,
        matchScope: 'CANONICAL',
        confidence: 'HIGH',
        evidenceConflict: false,
      }),
    ])
    expect(
      firstResolution.candidates[0]?.evidence.find(
        (item) => item.kind === 'CROSSWALK' && item.provider === 'AUVIK',
      ),
    ).toMatchObject({
      sourceId: 'auvik-ap01',
      serialNumber: null,
    })

    await identityStore.recordSuccessfulImporterV2Publication({
      provider: 'ARUBA',
      sourceAdapterId: 'aruba-central-api-v1',
      profileVersion: '1',
      evaluationFingerprint: `aruba-first-${suffix}`,
      isFullInventoryExport: true,
      rows: [
        {
          rowNumber: 1,
          canonicalDeviceId: ap01.id,
          sourceRecordKey: 'aruba-ap01',
          rowFingerprint: `aruba-ap01-${suffix}`,
          identifiers: arubaIdentifiers,
          values: {
            customer: customer.name,
            site: site.name,
            vendor: vendor.name,
            model: model.model,
            deviceType: deviceType.name,
            deviceName: 'AP01',
          },
        },
      ],
    })

    const crosswalks = await db.importerV2DeviceCrosswalk.findMany({
      where: { canonicalDeviceId: ap01.id },
      orderBy: { provider: 'asc' },
      select: {
        provider: true,
        sourceId: true,
        serialNumber: true,
      },
    })
    expect(crosswalks).toEqual([
      {
        provider: 'ARUBA',
        sourceId: 'aruba-ap01',
        serialNumber: 'AP01-CORRECT',
      },
      {
        provider: 'AUVIK',
        sourceId: 'auvik-ap01',
        serialNumber: null,
      },
    ])

    const secondCandidates = await identityStore.buildImporterV2IdentityCandidateResolver({
      provider: 'ARUBA',
      identifiers: [arubaIdentifiers],
    })
    const secondResolution = identity.resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-central-api-v1',
        identifiers: arubaIdentifiers,
      },
      secondCandidates(arubaIdentifiers),
    )

    expect(secondResolution).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: false,
    })
    expect(secondResolution.candidates[0]).toMatchObject({
      canonicalDeviceId: ap01.id,
      matchScope: 'SAME_PROVIDER',
      confidence: 'HIGH',
    })
    expect(
      secondResolution.candidates[0]?.signals.find(
        (signal) => signal.kind === 'SOURCE_ID',
      ),
    ).toMatchObject({ status: 'AGREE' })
  }, 120000)

  it('isolates provider Source IDs and makes a serial/MAC split ambiguous', async () => {
    const suffix = randomUUID().slice(0, 8)
    const customer = await db.customer.create({
      data: { code: `ISO-${suffix}`, name: `Isolation ${suffix}` },
    })
    const site = await db.site.create({
      data: { customerId: customer.id, name: 'Site B' },
    })
    const vendor = await db.vendor.create({
      data: { code: `ISO-V-${suffix}`, name: `Vendor ${suffix}` },
    })
    const deviceType = await db.deviceType.create({
      data: { code: `ISO-T-${suffix}`, name: `Type ${suffix}` },
    })
    const model = await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: `Model ${suffix}`,
        platform: 'TestOS',
      },
    })
    const deviceA = await db.device.create({
      data: {
        customerId: customer.id,
        siteId: site.id,
        deviceModelId: model.id,
        name: 'Device A',
        serialNumber: 'SERIAL-A',
      },
    })
    const deviceB = await db.device.create({
      data: {
        customerId: customer.id,
        siteId: site.id,
        deviceModelId: model.id,
        name: 'Device B',
        serialNumber: 'SERIAL-B',
      },
    })
    await db.importerV2DeviceCrosswalk.createMany({
      data: [
        {
          provider: 'AUVIK',
          sourceAdapterId: 'auvik-api-v2',
          canonicalDeviceId: deviceA.id,
          sourceId: '123',
          normalizedSourceId: '123',
          serialNumber: 'SERIAL-A',
          normalizedSerialNumber: 'SERIAL-A',
        },
        {
          provider: 'AUVIK',
          sourceAdapterId: 'auvik-api-v2',
          canonicalDeviceId: deviceB.id,
          sourceId: 'auvik-b',
          normalizedSourceId: 'auvik-b',
          macAddress: '00:11:22:33:44:55',
          normalizedMacAddress: '001122334455',
        },
      ],
    })

    const isolatedIdentifiers = { sourceId: '123' }
    const isolatedCandidates =
      await identityStore.buildImporterV2IdentityCandidateResolver({
        provider: 'ARUBA',
        identifiers: [isolatedIdentifiers],
      })
    expect(isolatedCandidates(isolatedIdentifiers)).toEqual([])

    const splitIdentifiers = {
      sourceId: 'aruba-split',
      serialNumber: 'SERIAL-A',
      macAddress: '00:11:22:33:44:55',
    }
    const splitCandidates = await identityStore.buildImporterV2IdentityCandidateResolver({
      provider: 'ARUBA',
      identifiers: [splitIdentifiers],
    })
    const splitResolution = identity.resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-central-api-v1',
        identifiers: splitIdentifiers,
      },
      splitCandidates(splitIdentifiers),
    )

    expect(splitResolution.kind).toBe('AMBIGUOUS')
    expect(splitResolution.requiresConfirmation).toBe(true)
    expect(splitResolution.candidates.map((candidate) => candidate.canonicalDeviceId).sort()).toEqual(
      [deviceA.id, deviceB.id].sort(),
    )
  }, 120000)
})
