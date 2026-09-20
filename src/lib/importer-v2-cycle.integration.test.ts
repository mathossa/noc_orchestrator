import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'
import type { ImporterV2ColumnMapping } from './importer-v2-source-profiles'

function crc32(input: Buffer) {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: readonly { name: string; content: string }[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.content)
    const checksum = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, name)

    localOffset += local.length + name.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const localDirectory = Buffer.concat(localParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localDirectory.length, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([localDirectory, centralDirectory, end])
}

function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function columnName(index: number) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function syntheticXlsx(headers: readonly string[], rows: readonly string[][]) {
  const worksheetRows = [headers, ...rows]
    .map((values, rowIndex) => {
      const cells = values
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`,
        )
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  return storedZip([
    {
      name: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Devices" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<worksheet><sheetData>${worksheetRows}</sheetData></worksheet>`,
    },
  ])
}

describe('Importer v2 PostgreSQL complete functional cycle', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let ingestion: typeof import('./importer-v2-workspace-maintenance')
  let workspace: typeof import('./importer-v2-workspace-store')
  let publication: typeof import('./importer-v2-publication-store')

  const headers = [
    'Source ID',
    'Customer',
    'Site',
    'Device Name',
    'Hostname',
    'Management Address',
    'Serial Number',
    'Vendor',
    'Model',
    'Device Type',
  ] as const

  const columnMappings = headers.map((sourceHeader, columnIndex) => ({
    columnIndex,
    sourceHeader,
    targetField: [
      'sourceId',
      'customer',
      'site',
      'deviceName',
      'hostname',
      'managementAddress',
      'serialNumber',
      'vendor',
      'model',
      'deviceType',
    ][columnIndex],
  })) as ImporterV2ColumnMapping[]

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    ingestion = await import('./importer-v2-workspace-maintenance')
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

  it('covers upload, evaluate, reconcile, validate, publish and repeat-import', async () => {
    const provider = 'CycleCMDB'
    const sourceAdapterId = 'cycle-xlsx'
    const sourceId = 'cycle-source-1'
    const serialNumber = 'CYCLE-SERIAL-1'

    const customer = await db.customer.create({
      data: { code: 'CYCLE-CUSTOMER', name: 'Cycle Customer' },
    })
    await db.site.create({
      data: { customerId: customer.id, name: 'Cycle Site' },
    })
    const vendor = await db.vendor.create({
      data: { code: 'CYCLE-VENDOR', name: 'Cycle Vendor' },
    })
    const deviceType = await db.deviceType.create({
      data: { code: 'CYCLE-SWITCH', name: 'Cycle Switch' },
    })
    await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: 'Cycle Model',
        platform: 'CycleOS',
      },
    })

    const firstWorkbook = syntheticXlsx(headers, [
      [
        sourceId,
        'Cycle Customer',
        'Cycle Site',
        'cycle-device',
        'source-host-1',
        '10.0.0.10',
        serialNumber,
        'Cycle Vendor',
        'Cycle Model',
        'Cycle Switch',
      ],
    ])
    const firstFile = new File([firstWorkbook], 'cycle.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const first = await ingestion.stageImporterV2XlsxWithAutomation({
      file: firstFile,
      config: {
        provider,
        sourceAdapterId,
        sheetName: 'Devices',
        headerRow: 1,
        columnMappings,
        profileName: `cycle-profile-${randomUUID()}`,
        confirmProfile: true,
      },
    })

    expect(first.batch.rowCount).toBe(1)

    const selection = { mode: 'ROWS' as const, rowNumbers: [2] }
    const action = {
      type: 'SET_FIELD' as const,
      field: 'managementAddress' as const,
      value: { id: null, label: '10.0.0.11' },
      explanation: 'Engineer corrected the management address before publication.',
    }
    const preview = await workspace.previewImporterV2WorkspaceAction({
      batchId: first.batch.id,
      selection,
      action,
    })
    await workspace.applyImporterV2WorkspaceAction({
      batchId: first.batch.id,
      selection,
      action,
      scopeToken: preview.scopeToken,
    })
    const recheck = await ingestion.recheckImporterV2Workspace(
      first.batch.id,
      preview.scopeToken,
    )
    expect(recheck.checked).toBe(1)

    const firstQa = await publication.getImporterV2PublicationQa(first.batch.id)
    expect(firstQa.publication.unresolvedRows).toHaveLength(0)
    expect(firstQa.publication.allResolvedCandidateRows).toEqual([2])

    const firstResult = await publication.publishImporterV2Batch({
      batchId: first.batch.id,
      mode: 'ALL_RESOLVED',
      qaFingerprint: firstQa.qaFingerprint,
      idempotencyKey: randomUUID(),
      approvedProposalKeys: firstQa.catalogProposals.map((item) => item.key),
    })

    const canonicalDeviceId = firstResult.publishedRows[0]?.canonicalDeviceId
    expect(canonicalDeviceId).toBeTruthy()

    const firstDevice = await db.device.findUniqueOrThrow({
      where: { id: canonicalDeviceId },
      select: { managementAddress: true },
    })
    expect(firstDevice.managementAddress).toBe('10.0.0.11')

    await db.device.update({
      where: { id: canonicalDeviceId },
      data: { hostname: 'manual-hostname' },
    })

    const secondWorkbook = syntheticXlsx(headers, [
      [
        sourceId,
        'Cycle Customer',
        'Cycle Site',
        'cycle-device',
        'source-host-2',
        '10.0.0.12',
        serialNumber,
        'Cycle Vendor',
        'Cycle Model',
        'Cycle Switch',
      ],
    ])
    const secondFile = new File([secondWorkbook], 'cycle.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const second = await ingestion.stageImporterV2XlsxWithAutomation({
      file: secondFile,
      config: {
        provider,
        sourceAdapterId,
        sheetName: 'Devices',
        headerRow: 1,
        columnMappings,
        profileId: first.profile.id,
        confirmProfile: true,
      },
    })

    const repeatRow = await workspace.getImporterV2WorkspaceRow(second.batch.id, 2)
    const repeatDiff = repeatRow.repeatDiff as {
      classification?: string
      changeKinds?: string[]
      proposals?: Array<{
        field?: string
        allowed?: boolean
        reason?: string
      }>
    }

    expect(repeatDiff.classification).toBe('RENAMED')
    expect(repeatDiff.changeKinds).toEqual(['RENAMED', 'CHANGED'])
    expect(
      repeatDiff.proposals?.find((proposal) => proposal.field === 'hostname'),
    ).toMatchObject({
      allowed: false,
      reason: 'MANUAL_VALUE_PROTECTED',
    })
    expect(
      repeatDiff.proposals?.find(
        (proposal) => proposal.field === 'managementAddress',
      ),
    ).toMatchObject({
      allowed: true,
      reason: 'SOURCE_OWNED_VALUE',
    })

    const secondQa = await publication.getImporterV2PublicationQa(second.batch.id)
    expect(secondQa.publication.unresolvedRows).toHaveLength(0)

    const secondResult = await publication.publishImporterV2Batch({
      batchId: second.batch.id,
      mode: 'ALL_RESOLVED',
      qaFingerprint: secondQa.qaFingerprint,
      idempotencyKey: randomUUID(),
      approvedProposalKeys: secondQa.catalogProposals.map((item) => item.key),
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
      },
    })
    expect(updated.hostname).toBe('manual-hostname')
    expect(updated.managementAddress).toBe('10.0.0.12')
    expect(await db.device.count()).toBe(1)
  }, 120000)
})
