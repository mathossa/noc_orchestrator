import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Type-checking and emitting worker JS cannot detect unresolved Node ESM imports.
// Import the same provider handlers that inventory.sync loads when a real cron
// job fires, without hitting APIs, running a sync or opening the database.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for worker runtime verification.')
}

function builtModule(path) {
  return pathToFileURL(resolve('.worker-dist', path)).href
}

let database
try {
  database = await import(builtModule('src/lib/prisma.js'))
  await import(builtModule('src/lib/meraki-inventory-sync.js'))
  await import(builtModule('src/lib/auvik-inventory-sync.js'))
  console.info('Compiled worker can import Prisma, Meraki and Auvik sync services.')
} finally {
  await database?.prisma?.$disconnect()
}
