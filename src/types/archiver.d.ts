// archiver v7 is already present in the repository lockfile; it does not bundle
// TypeScript declarations. Only the API used by the XLSX exporter is declared.
declare module 'archiver' {
  import type { Readable } from 'node:stream'

  interface ReportZipArchive extends Readable {
    append(source: Buffer | string, data: { name: string }): this
    finalize(): Promise<void>
  }

  function archiver(
    format: 'zip',
    options: { zlib: { level: number } },
  ): ReportZipArchive

  export = archiver
}
