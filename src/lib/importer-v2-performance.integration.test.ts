// Run only against a disposable, migrated PostgreSQL database:
// IMPORTER_TEST_DATABASE_URL=... npx vitest run src/lib/importer-v2-performance.integration.test.ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildImporterV2ScaleFixture } from './importer-v2-regression-fixtures'
import { parseImporterV2WorkspaceQuery } from './importer-v2-workspace'

const databaseUrl = process.env.IMPORTER_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)(
  'Importer v2 PostgreSQL 12,000-row performance',
  () => {
    let db: (typeof import('./prisma'))['prisma']
    let workspace: typeof import('./importer-v2-workspace-store')
    let maintenance: typeof import('./importer-v2-workspace-maintenance')
    let batchId: string
    const timings: Record<string, number> = {}
    async function measure<T>(phase: string, run: () => Promise<T>) {
      const start = performance.now()
      const result = await run()
      timings[phase] = performance.now() - start
      return result
    }
    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl
      db = (await import('./prisma')).prisma
      workspace = await import('./importer-v2-workspace-store')
      maintenance = await import('./importer-v2-workspace-maintenance')
      const fixture = buildImporterV2ScaleFixture()
      const batch = await measure('stage database', () =>
        workspace.stageImporterV2Workspace({
          name: `issue52-${randomUUID()}`,
          provider: 'SyntheticCMDB',
          sourceAdapterId: 'synthetic',
          profileId: 'performance',
          profileVersion: '1',
          evaluationFingerprint: randomUUID(),
          rows: fixture.map((row) => ({
            rowNumber: row.rowNumber,
            sourceFingerprint: String(row.rowNumber),
            inclusion: 'INCLUDED',
            statuses: ['NEEDS_REVIEW'],
            primaryStatus: 'NEEDS_REVIEW',
            issueCount: 0,
            hasErrors: false,
            customer: row.source.customer,
            sourceName: row.source.deviceName,
            evaluated: {
              rawValues: row.source,
              proposedCanonicalValues: {
                customer: { id: null, label: row.source.customer },
              },
              fields: {},
              issues: [],
            },
          })),
        }),
      )
      batchId = batch.id
    }, 120000)
    afterAll(async () => {
      if (batchId)
        await db.importerV2WorkspaceBatch.delete({ where: { id: batchId } })
      if (db) await db.$disconnect()
      console.info(
        'Importer v2 database timings (ms):',
        JSON.stringify(timings),
      )
    })
    it('keeps page two bounded and aggregates the entire filtered batch below 1s p95', async () => {
      const samples: number[] = []
      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        const result = await workspace.queryImporterV2Workspace(
          batchId,
          parseImporterV2WorkspaceQuery(
            new URLSearchParams({
              page: '2',
              pageSize: '100',
              groupBy: 'customer',
            }),
          ),
        )
        samples.push(performance.now() - start)
        expect(result.rows).toHaveLength(100)
        expect(result.rows[0].rowNumber).toBeGreaterThan(100)
        expect(result.total).toBe(12000)
        expect(result.groups.reduce((sum, group) => sum + group.count, 0)).toBe(
          12000,
        )
      }
      timings['workspace with groups p95'] = samples.sort((a, b) => a - b)[18]
      expect(timings['workspace with groups p95']).toBeLessThan(1000)
    }, 60000)
    it('rechecks five corrected rows without clearing unrelated pending work', async () => {
      const selection = { mode: 'ROWS' as const, rowNumbers: [2, 3, 4, 5, 6] }
      const action = {
        type: 'SET_FIELD' as const,
        field: 'deviceName' as const,
        value: { id: null, label: 'Corrected name' },
        explanation: 'Synthetic local correction',
      }
      const preview = await workspace.previewImporterV2WorkspaceAction({
        batchId,
        selection,
        action,
      })
      await workspace.applyImporterV2WorkspaceAction({
        batchId,
        selection,
        action,
        scopeToken: preview.scopeToken,
      })
      await db.importerV2WorkspaceRow.updateMany({
        where: { batchId, rowNumber: 7 },
        data: { needsReevaluation: true },
      })
      const result = await measure('targeted correction recheck', () =>
        maintenance.recheckImporterV2Workspace(batchId, preview.scopeToken),
      )
      expect(result.checked).toBe(5)
      expect(
        await db.importerV2WorkspaceRow.count({
          where: { batchId, needsReevaluation: true },
        }),
      ).toBe(1)
      expect(timings['targeted correction recheck']).toBeLessThan(1000)
    }, 60000)
    it('measures deliberate whole-batch recheck separately', async () => {
      const result = await measure('whole-batch recheck', () =>
        maintenance.recomputeImporterV2WorkspaceRows({ batchId }),
      )
      expect(result.checked).toBe(12000)
      expect(timings['whole-batch recheck']).toBeLessThanOrEqual(30000)
    }, 120000)
  },
)
