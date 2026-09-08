// Run with PGLITE_MODULE pointing at a separately installed @electric-sql/pglite
// entry point. No application dependency or production database is needed.
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(
  process.env.PGLITE_MODULE || '@electric-sql/pglite'
)
const db = new PGlite()
const migrations = (await readdir('prisma/migrations'))
  .filter((name) => /^\d/.test(name))
  .sort()
let count = 0
for (const migration of migrations) {
  if (migration === '20260907150000_customer_organization_units') {
    await db.exec(
      `INSERT INTO "Customer" ("id", "name") VALUES ('fixture-c', 'Example'), ('fixture-other', 'Other'); INSERT INTO "Site" ("id", "customerId", "name", "code") VALUES ('legacy', 'fixture-c', 'Springfield', 'HQ');`,
    )
  }
  await db.exec(
    await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
  )
  count++
}
assert.deepEqual(
  (
    await db.query(
      `SELECT "organizationUnitId", "name" FROM "Site" WHERE id='legacy'`,
    )
  ).rows,
  [{ organizationUnitId: null, name: 'Springfield' }],
)
await db.exec(
  `INSERT INTO "CustomerOrganizationUnit" (id, "customerId", name) VALUES ('east', 'fixture-c', 'East'), ('west', 'fixture-c', 'West'), ('foreign', 'fixture-other', 'Foreign'); INSERT INTO "Site" (id, "customerId", "organizationUnitId", name, code) VALUES ('east-site', 'fixture-c', 'east', 'Springfield', 'HQ'), ('west-site', 'fixture-c', 'west', 'Springfield', 'HQ');`,
)
await assert.rejects(
  db.exec(
    `INSERT INTO "Site" (id, "customerId", "organizationUnitId", name) VALUES ('invalid', 'fixture-c', 'foreign', 'Invalid')`,
  ),
  /foreign key/,
)
await assert.rejects(
  db.exec(
    `INSERT INTO "CustomerOrganizationUnit" (id, "customerId", "parentId", name) VALUES ('invalid', 'fixture-c', 'foreign', 'Invalid')`,
  ),
  /foreign key/,
)
await assert.rejects(
  db.exec(
    `INSERT INTO "Site" (id, "customerId", "organizationUnitId", name) VALUES ('duplicate', 'fixture-c', 'east', ' springfield ')`,
  ),
  /unique/,
)
await assert.rejects(
  db.exec(
    `INSERT INTO "Site" (id, "customerId", name) VALUES ('duplicate', 'fixture-c', ' springfield ')`,
  ),
  /unique/,
)
await assert.rejects(
  db.exec(`DELETE FROM "CustomerOrganizationUnit" WHERE id='east'`),
  /foreign key/,
)
await db.exec(
  `UPDATE "CustomerOrganizationUnit" SET "isActive"=false WHERE id='east'`,
)
assert.equal(
  (
    await db.query(
      `SELECT count(*)::int AS count FROM "Site" WHERE "organizationUnitId"='east'`,
    )
  ).rows[0].count,
  1,
)
await db.close()
// Also apply the exact chain to a completely empty database.
const clean = new PGlite()
for (const migration of migrations)
  await clean.exec(
    await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
  )
await clean.close()
console.log(
  `${count} migrations passed on clean and populated databases; legacy data, scoped uniqueness, cross-customer FKs, and referenced deactivation passed.`,
)
