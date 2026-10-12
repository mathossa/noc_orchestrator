import { prisma } from '@/lib/prisma'
import {
  firmwareDocumentTypes,
  isSafeFirmwareDocumentUrl,
  mergeFirmwareDocumentLinks,
  suggestFirmwareDocuments,
  type FirmwareDocumentLink,
  type FirmwareDocumentMatch,
  type FirmwareDocumentType,
} from './firmware-release-documentation'

export class FirmwareDocumentationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'FirmwareDocumentationError'
  }
}

function parseInput(raw: unknown, patch = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FirmwareDocumentationError('Provide a document object.')
  }
  const input = raw as Record<string, unknown>
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key)
  const type = input.type
  const title = input.title
  const url = input.url
  const source = input.source
  const notes = input.notes
  const match = input.match

  if ((!patch || has('type')) && !firmwareDocumentTypes.includes(type as FirmwareDocumentType)) {
    throw new FirmwareDocumentationError('Choose a valid reference type.')
  }
  if ((!patch || has('title')) && (typeof title !== 'string' || !title.trim() || title.trim().length > 200)) {
    throw new FirmwareDocumentationError('Title must be between 1 and 200 characters.')
  }
  if ((!patch || has('url')) && !isSafeFirmwareDocumentUrl(url)) {
    throw new FirmwareDocumentationError('Provide an http(s) URL without embedded credentials.')
  }
  if ((!patch || has('source')) && (typeof source !== 'string' || !source.trim() || source.trim().length > 120)) {
    throw new FirmwareDocumentationError('Source must be between 1 and 120 characters.')
  }
  if (has('notes') && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
    throw new FirmwareDocumentationError('Notes must be at most 2000 characters.')
  }
  if (has('match') && match !== 'EXACT_VERSION' && match !== 'PLATFORM_INDEX') {
    throw new FirmwareDocumentationError('Choose exact release or platform index.')
  }
  if (patch && !['type', 'title', 'url', 'source', 'notes', 'match'].some(has)) {
    throw new FirmwareDocumentationError('No editable documentation fields supplied.')
  }

  return {
    ...(has('type') ? { type: type as string } : {}),
    ...(has('title') ? { title: (title as string).trim() } : {}),
    ...(has('url') ? { url: (url as string).trim() } : {}),
    ...(has('source') ? { source: (source as string).trim() } : {}),
    ...(has('notes') ? { notes: typeof notes === 'string' ? notes.trim() || null : null } : {}),
    ...(has('match') ? { match: match as string } : {}),
  }
}

function toLink(row: {
  id: string; type: string; title: string; url: string;
  source: string; notes: string | null; match: string; verifiedAt: Date | null
}): FirmwareDocumentLink {
  return {
    id: row.id,
    type: row.type as FirmwareDocumentType,
    title: row.title,
    url: row.url,
    source: row.source,
    notes: row.notes,
    origin: 'MANUAL',
    match: row.match as FirmwareDocumentMatch,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  }
}

export async function listReleaseDocumentation(firmwareReleaseId: string) {
  const release = await prisma.firmwareRelease.findUnique({
    where: { id: firmwareReleaseId },
    select: {
      id: true,
      version: true,
      platform: true,
      releaseNotesUrl: true,
      vendor: { select: { code: true, name: true } },
      documentation: { orderBy: [{ type: 'asc' }, { title: 'asc' }] },
    },
  })
  if (!release) throw new FirmwareDocumentationError('Firmware release not found.', 404)

  const stored = release.documentation.map(toLink)
  if (release.releaseNotesUrl && isSafeFirmwareDocumentUrl(release.releaseNotesUrl)) {
    stored.push({
      id: 'legacy:releaseNotesUrl',
      type: 'RELEASE_NOTES',
      title: 'Existing release notes URL',
      url: release.releaseNotesUrl,
      source: 'Firmware catalog',
      notes: 'Legacy field: edit this from the firmware release editor.',
      origin: 'LEGACY',
      match: 'EXACT_VERSION',
      verifiedAt: null,
    })
  }
  return {
    release: { id: release.id, version: release.version, platform: release.platform, vendor: release.vendor },
    data: mergeFirmwareDocumentLinks(stored, suggestFirmwareDocuments(release)),
  }
}

export async function createReleaseDocumentation(firmwareReleaseId: string, input: unknown) {
  const data = parseInput(input)
  const exists = await prisma.firmwareRelease.findUnique({ where: { id: firmwareReleaseId }, select: { id: true } })
  if (!exists) throw new FirmwareDocumentationError('Firmware release not found.', 404)
  try {
    const created = await prisma.firmwareReleaseDocument.create({
      data: {
        firmwareReleaseId,
        type: data.type!,
        title: data.title!,
        url: data.url!,
        source: data.source!,
        notes: data.notes ?? null,
        match: data.match ?? 'EXACT_VERSION',
      },
    })
    return toLink(created)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new FirmwareDocumentationError('This URL is already attached to the release.', 409)
    }
    throw error
  }
}

async function requireDocument(firmwareReleaseId: string, documentId: string) {
  const doc = await prisma.firmwareReleaseDocument.findFirst({
    where: { id: documentId, firmwareReleaseId },
  })
  if (!doc) throw new FirmwareDocumentationError('Documentation link not found.', 404)
  return doc
}

export async function updateReleaseDocumentation(firmwareReleaseId: string, documentId: string, input: unknown) {
  await requireDocument(firmwareReleaseId, documentId)
  const data = parseInput(input, true)
  try {
    const updated = await prisma.firmwareReleaseDocument.update({ where: { id: documentId }, data: { ...data, verifiedAt: null } })
    return toLink(updated)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new FirmwareDocumentationError('This URL is already attached to the release.', 409)
    }
    throw error
  }
}

export async function deleteReleaseDocumentation(firmwareReleaseId: string, documentId: string) {
  await requireDocument(firmwareReleaseId, documentId)
  await prisma.firmwareReleaseDocument.delete({ where: { id: documentId } })
}
