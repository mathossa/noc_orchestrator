// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from 'node:child_process'
import process from 'node:process'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

const { Client } = pg
const POSTGRES_IMAGE = 'postgres:17-alpine'
const TEST_DATABASE = 'noc_orchestrator_test'
const TEST_USERNAME = 'noc_orchestrator_test'
const TEST_PASSWORD = 'noc_orchestrator_test'

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          signal
            ? `${command} ${args.join(' ')} exited on ${signal}`
            : `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`,
        ),
      )
    })
  })
}

async function applyPrismaMigrations(databaseUrl) {
  await runCommand(npmCommand(), ['run', 'prisma:deploy'], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  })
}

async function withClient(databaseUrl, work) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

async function resetDatabase(databaseUrl) {
  await withClient(databaseUrl, async (client) => {
    await client.query(`
      DO $$
      DECLARE
        tables_to_truncate text;
      BEGIN
        SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
          INTO tables_to_truncate
          FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename <> '_prisma_migrations';

        IF tables_to_truncate IS NOT NULL THEN
          EXECUTE 'TRUNCATE TABLE ' || tables_to_truncate || ' RESTART IDENTITY CASCADE';
        END IF;
      END $$;
    `)
  })
}

/**
 * Starts a disposable PostgreSQL matching local development, applies the real
 * Prisma migration history, and returns only the small lifecycle operations
 * integration/E2E tests need.
 */
export async function startPostgresTestDatabase() {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(TEST_DATABASE)
    .withUsername(TEST_USERNAME)
    .withPassword(TEST_PASSWORD)
    .start()

  const databaseUrl = container.getConnectionUri()
  let stopped = false

  try {
    await applyPrismaMigrations(databaseUrl)
  } catch (error) {
    await container.stop()
    throw error
  }

  return {
    databaseUrl,
    async reset() {
      await resetDatabase(databaseUrl)
    },
    async seed(seed) {
      return withClient(databaseUrl, seed)
    },
    async stop() {
      if (stopped) return
      stopped = true
      await container.stop()
    },
  }
}
