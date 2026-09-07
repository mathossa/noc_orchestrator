import type { Prisma } from '../generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'
import { importerV2WorkspaceWhere } from '@/lib/importer-v2-workspace-store'

function selectionWhere(
  batchId: string,
  selection: ImporterV2WorkspaceSelection,
): Prisma.ImporterV2WorkspaceRowWhereInput {
  if (selection.mode === 'ROWS') {
    return {
      batchId,
      rowNumber: { in: [...new Set(selection.rowNumbers)] },
    }
  }
  return importerV2WorkspaceWhere(batchId, selection.filters)
}

function directOverlay(
  action: ImporterV2WorkspaceAction,
): Prisma.ImporterV2WorkspaceRowUpdateManyMutationInput | null {
  if (
    action.type !== 'SET_FIELD' &&
    action.type !== 'LINK_FIELD' &&
    action.type !== 'CLEAR_FIELD'
  ) {
    return null
  }

  const value = action.type === 'CLEAR_FIELD' ? null : action.value.label

  switch (action.field) {
    case 'customer':
      return { customer: value }
    case 'businessUnit':
      return { businessUnit: value }
    case 'site':
      return { site: value }
    case 'deviceName':
      return { sourceName: value }
    case 'hostname':
      return { hostname: value }
    case 'vendor':
      return { vendor: value }
    case 'productFamily':
      return { productFamily: value }
    case 'softwarePlatform':
      return { softwarePlatform: value }
    case 'model':
      return { canonicalModel: value }
    case 'deviceType':
      return { deviceType: value }
    case 'currentFirmware':
      return { interpretedFirmware: value }
    default:
      // Raw source evidence (for example Firmware Version / Software Version),
      // durable identifiers and notes stay immutable in the denormalized grid.
      // Their review decision is persisted and the row is re-evaluated instead.
      return null
  }
}

export async function applyImporterV2WorkspaceEffectiveOverlay(input: {
  batchId: string
  selection: ImporterV2WorkspaceSelection
  action: ImporterV2WorkspaceAction
}) {
  const data = directOverlay(input.action)
  if (!data) return

  await prisma.importerV2WorkspaceRow.updateMany({
    where: selectionWhere(input.batchId, input.selection),
    data,
  })
}
