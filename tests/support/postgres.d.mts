export type TestPostgresDatabase = {
  databaseUrl: string
  /** Disconnect database clients before restoring the migrated snapshot. */
  reset(): Promise<void>
  seed<T>(seed: (databaseUrl: string) => Promise<T>): Promise<T>
  stop(): Promise<void>
}

export function startPostgresTestDatabase(): Promise<TestPostgresDatabase>
