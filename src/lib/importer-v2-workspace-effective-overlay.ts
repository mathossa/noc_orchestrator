import type { Prisma } from '../generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ImporterV2WorkspaceAction } from '@/lib/importer-v2-workspace'

export function importerV2WorkspaceDirectOverlay(
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
  scopeToken: string
  action: ImporterV2WorkspaceAction
}) {
  const data = importerV2WorkspaceDirectOverlay(input.action)
  if (!data) return

  const decisions = await prisma.importerV2WorkspaceDecision.findMany({
    where: {
      batchId: input.batchId,
      scopeToken: input.scopeToken,
      action: input.action.type,
    },
    select: { rowId: true },
  })
  const rowIds = [...new Set(decisions.map((decision) => decision.rowId))]
  if (rowIds.length === 0) return

  await prisma.importerV2WorkspaceRow.updateMany({
    where: { id: { in: rowIds } },
    data,
  })
}
