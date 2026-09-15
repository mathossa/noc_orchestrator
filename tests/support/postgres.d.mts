import type { Client } from 'pg'

export type TestPostgresDatabase = {
  databaseUrl: string
  reset(): Promise<void>
  seed<T>(seed: (client: Client) => Promise<T>): Promise<T>
  stop(): Promise<void>
}

export function startPostgresTestDatabase(): Promise<TestPostgresDatabase>
