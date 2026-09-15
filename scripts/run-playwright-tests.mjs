// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from 'node:child_process'
import process from 'node:process'
import { startPostgresTestDatabase } from '../tests/support/postgres.mjs'

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runPlaywright(databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      npmCommand(),
      ['exec', '--', 'playwright', 'test', ...process.argv.slice(2)],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'inherit',
      },
    )

    const forwardSignal = (signal) => child.kill(signal)
    process.once('SIGINT', forwardSignal)
    process.once('SIGTERM', forwardSignal)

    child.once('error', (error) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      if (code === 0) resolve()
      else if (signal) reject(new Error(`Playwright exited on ${signal}`))
      else reject(new Error(`Playwright exited with code ${code ?? 'unknown'}`))
    })
  })
}

const database = await startPostgresTestDatabase()

try {
  await database.reset()
  await runPlaywright(database.databaseUrl)
} finally {
  await database.stop()
}
