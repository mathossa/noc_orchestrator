import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'
import { DeviceValidationError } from '@/lib/devices'
import { DeviceConflictError, DeviceNotFoundError } from '@/lib/device-store'

export function parseDeviceAnnotation(input: unknown) {
  const body =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const action = body.action
  if (!['ADD_NOTE', 'FLAG', 'RESOLVE_FLAG'].includes(String(action))) {
    throw new DeviceValidationError('Choose an annotation action.', {
      action: 'Invalid action.',
    })
  }
  const text =
    typeof body.text === 'string' ? body.text.normalize('NFKC').trim() : ''
  if (action !== 'RESOLVE_FLAG' && (!text || text.length > 1000)) {
    throw new DeviceValidationError(
      'Enter a note or issue description (1–1000 characters).',
      { text: 'Enter 1–1000 characters.' },
    )
  }
  return { action: action as 'ADD_NOTE' | 'FLAG' | 'RESOLVE_FLAG', text }
}

/** Annotations remain possible for incompatible/blocked devices. Only these
 * fields are mutated; technical firmware and planning are never rewritten. */
export async function annotateDevice(
  id: string,
  raw: unknown,
  actorUserId: string | null = null,
) {
  const { action, text } = parseDeviceAnnotation(raw)
  return prisma.$transaction(async (tx) => {
    const current = await tx.device.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        notes: true,
        issueReason: true,
        issueFlaggedAt: true,
        updatedAt: true,
      },
    })
    if (!current) throw new DeviceNotFoundError()
    if (action === 'FLAG' && current.issueReason)
      throw new DeviceConflictError(
        'This device already has an open issue. Refresh to review it.',
      )
    if (action === 'RESOLVE_FLAG' && !current.issueReason) return
    const notes = [current.notes, text].filter(Boolean).join('\n\n')
    if (action === 'ADD_NOTE' && notes.length > 5000) {
      throw new DeviceValidationError(
        'Device notes exceed 5000 characters. Edit existing notes first.',
        { text: 'Notes limit reached.' },
      )
    }
    const data =
      action === 'ADD_NOTE'
        ? { notes }
        : {
            issueReason: action === 'FLAG' ? text : null,
            issueFlaggedAt: action === 'FLAG' ? new Date() : null,
          }
    const updated = await tx.device.updateMany({
      where: { id, updatedAt: current.updatedAt },
      data,
    })
    if (updated.count !== 1)
      throw new DeviceConflictError(
        'The device changed. Refresh before saving your annotation.',
      )
    await tx.auditEvent.create({
      data: {
        actorUserId,
        customerId: current.customerId,
        entityType: 'Device',
        entityId: id,
        action:
          action === 'ADD_NOTE'
            ? AUDIT_ACTIONS.deviceNoteAdded
            : action === 'FLAG'
              ? AUDIT_ACTIONS.deviceIssueFlagged
              : AUDIT_ACTIONS.deviceIssueResolved,
        before:
          action === 'ADD_NOTE'
            ? { notes: current.notes }
            : {
                issueReason: current.issueReason,
                issueFlaggedAt: current.issueFlaggedAt?.toISOString() ?? null,
              },
        after:
          action === 'ADD_NOTE'
            ? { notes }
            : {
                issueReason: data.issueReason ?? null,
                issueFlaggedAt: data.issueFlaggedAt?.toISOString() ?? null,
              },
        metadata: action === 'ADD_NOTE' ? { note: text } : {},
      },
    })
  })
}
