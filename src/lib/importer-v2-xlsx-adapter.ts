import type { InventorySourceAdapter } from '@/lib/inventory-source-adapter'
import { normalizedInventorySource } from '@/lib/inventory-source-adapter'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import type { ImporterV2ColumnMapping } from '@/lib/importer-v2-source-profiles'
import {
  importerV2SourceEvidence,
  mappedImporterV2Rows,
} from '@/lib/importer-v2-xlsx'
import type { XlsxSheet } from '@/lib/xlsx-reader'

export const XLSX_INVENTORY_ADAPTER_TYPE = 'xlsx'

export type XlsxInventoryAdapterInput = {
  sheet: XlsxSheet
  headerRow: number
  headers: readonly string[]
  mappings: readonly ImporterV2ColumnMapping[]
  defaults?: Partial<Record<ImporterV2Field, string>>
}

export const xlsxInventorySourceAdapter: InventorySourceAdapter<XlsxInventoryAdapterInput> = {
  adapterType: XLSX_INVENTORY_ADAPTER_TYPE,

  loadAndNormalize({ source, input }) {
    if (source.adapterType !== XLSX_INVENTORY_ADAPTER_TYPE) {
      throw new Error(
        `XLSX inventory adapter cannot load source adapter type “${source.adapterType}”.`,
      )
    }

    const sourceRowsByNumber = new Map(
      input.sheet.rows.map((row) => [row.rowNumber, row]),
    )
    const rows = mappedImporterV2Rows({
      sheet: input.sheet,
      headerRow: input.headerRow,
      mappings: input.mappings,
      defaults: input.defaults,
    }).map((row) => {
      const sourceRow = sourceRowsByNumber.get(row.rowNumber)
      return {
        ...row,
        sourceEvidence: sourceRow
          ? importerV2SourceEvidence({
              sourceRow,
              headers: input.headers,
            })
          : {},
      }
    })

    return normalizedInventorySource({
      source,
      rows,
      metadata: {
        sheetName: input.sheet.name,
        headerRow: input.headerRow,
      },
    })
  },
}
