// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from 'node:child_process'
import process from 'node:process'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

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

/**
 * Starts a disposable PostgreSQL matching local development, applies the real
 * Prisma migration history, then snapshots that migrated baseline so tests can
 * reset without maintaining a second database-cleanup implementation.
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
    await container.snapshot()
  } catch (error) {
    await container.stop()
    throw error
  }

  return {
    databaseUrl,
    async reset() {
      await container.restoreSnapshot()
    },
    async seed(seed) {
      return seed(databaseUrl)
    },
    async stop() {
      if (stopped) return
      stopped = true
      await container.stop()
    },
  }
}
