import { prisma } from '@/lib/prisma'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { getImporterV2WorkspaceRow } from '@/lib/importer-v2-workspace-store'

export type ImporterV2CanonicalChoice = {
  id: string
  label: string
  description: string | null
  exactSourceMatch: boolean
}

export type ImporterV2CanonicalChoiceResult = {
  field: ImporterV2Field
  sourceValue: string | null
  currentValue: { id: string | null; label: string } | null
  searchable: boolean
  choices: ImporterV2CanonicalChoice[]
}

const SEARCHABLE_FIELDS = new Set<ImporterV2Field>([
  'customer',
  'businessUnit',
  'site',
  'vendor',
  'productFamily',
  'softwarePlatform',
  'model',
  'deviceType',
  'currentFirmware',
])

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function sameText(left: string | null | undefined, right: string | null | undefined) {
  const a = clean(left)?.toLocaleLowerCase('en-US')
  const b = clean(right)?.toLocaleLowerCase('en-US')
  return Boolean(a && b && a === b)
}

function limitedQuery(value: string | null | undefined) {
  return clean(value)?.slice(0, 120) ?? ''
}

function target(snapshot: unknown, field: ImporterV2Field) {
  const evaluated = snapshot as {
    proposedCanonicalValues?: Record<
      string,
      { id?: string | null; label?: string } | null
    >
    rawValues?: Record<string, string | null>
  }
  const proposed = evaluated.proposedCanonicalValues?.[field]
  if (proposed?.label) {
    return {
      id: typeof proposed.id === 'string' ? proposed.id : null,
      label: proposed.label,
    }
  }
  const raw = clean(evaluated.rawValues?.[field])
  return raw ? { id: null, label: raw } : null
}

async function exactCustomerId(value: { id: string | null; label: string } | null) {
  if (value?.id) return value.id
  if (!value?.label) return null
  return (
    await prisma.customer.findFirst({
      where: { isActive: true, name: { equals: value.label, mode: 'insensitive' } },
      select: { id: true },
    })
  )?.id ?? null
}

async function exactVendorId(value: { id: string | null; label: string } | null) {
  if (value?.id) return value.id
  if (!value?.label) return null
  return (
    await prisma.vendor.findFirst({
      where: { isActive: true, name: { equals: value.label, mode: 'insensitive' } },
      select: { id: true },
    })
  )?.id ?? null
}

async function exactDeviceTypeId(value: { id: string | null; label: string } | null) {
  if (value?.id) return value.id
  if (!value?.label) return null
  return (
    await prisma.deviceType.findFirst({
      where: { isActive: true, name: { equals: value.label, mode: 'insensitive' } },
      select: { id: true },
    })
  )?.id ?? null
}

export async function listImporterV2CanonicalChoices(input: {
  batchId: string
  rowNumber: number
  field: ImporterV2Field
  query?: string | null
  limit?: number
}): Promise<ImporterV2CanonicalChoiceResult> {
  const row = await getImporterV2WorkspaceRow(input.batchId, input.rowNumber)
  const effective = importerV2WorkspaceEffectiveEvaluated({
    evaluated: row.evaluated,
    inclusion: row.inclusion,
    decisions: row.decisions,
  })
  const snapshot = effective.evaluated
  const sourceValue = clean(
    (snapshot as { rawValues?: Record<string, string | null> }).rawValues?.[
      input.field
    ],
  )
  const currentValue = target(snapshot, input.field)
  const searchable = SEARCHABLE_FIELDS.has(input.field)
  if (!searchable) {
    return { field: input.field, sourceValue, currentValue, searchable, choices: [] }
  }

  const query = limitedQuery(input.query || sourceValue || currentValue?.label)
  const take = Math.max(1, Math.min(input.limit ?? 15, 30))
  const contains = query ? { contains: query, mode: 'insensitive' as const } : undefined
  const customer = target(snapshot, 'customer')
  const businessUnit = target(snapshot, 'businessUnit')
  const vendor = target(snapshot, 'vendor')
  const deviceType = target(snapshot, 'deviceType')
  const platform = clean(target(snapshot, 'softwarePlatform')?.label)
  const [customerId, vendorId, deviceTypeId] = await Promise.all([
    exactCustomerId(customer),
    exactVendorId(vendor),
    exactDeviceTypeId(deviceType),
  ])

  let choices: ImporterV2CanonicalChoice[] = []

  if (input.field === 'customer') {
    const records = await prisma.customer.findMany({
      where: { isActive: true, ...(contains ? { name: contains } : {}) },
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, code: true },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.name,
      description: record.code ? `Customer code ${record.code}` : null,
      exactSourceMatch: sameText(record.name, sourceValue),
    }))
  } else if (input.field === 'businessUnit') {
    const records = await prisma.customerOrganizationUnit.findMany({
      where: {
        isActive: true,
        ...(customerId ? { customerId } : {}),
        ...(contains ? { name: contains } : {}),
      },
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, customer: { select: { name: true } } },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.name,
      description: record.customer.name,
      exactSourceMatch: sameText(record.name, sourceValue),
    }))
  } else if (input.field === 'site') {
    const unitId = businessUnit?.id || null
    const records = await prisma.site.findMany({
      where: {
        isActive: true,
        ...(customerId ? { customerId } : {}),
        ...(unitId ? { organizationUnitId: unitId } : {}),
        ...(contains ? { name: contains } : {}),
      },
      orderBy: { name: 'asc' },
      take,
      select: {
        id: true,
        name: true,
        customer: { select: { name: true } },
        organizationUnit: { select: { name: true } },
      },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.name,
      description: [record.customer.name, record.organizationUnit?.name]
        .filter(Boolean)
        .join(' · '),
      exactSourceMatch: sameText(record.name, sourceValue),
    }))
  } else if (input.field === 'vendor') {
    const records = await prisma.vendor.findMany({
      where: { isActive: true, ...(contains ? { name: contains } : {}) },
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, code: true },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.name,
      description: record.code,
      exactSourceMatch: sameText(record.name, sourceValue),
    }))
  } else if (input.field === 'productFamily') {
    const records = await prisma.deviceModelFamily.findMany({
      where: {
        isActive: true,
        ...(vendorId ? { vendorId } : {}),
        ...(contains ? { name: contains } : {}),
      },
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, vendor: { select: { name: true } } },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.name,
      description: record.vendor.name,
      exactSourceMatch: sameText(record.name, sourceValue),
    }))
  } else if (input.field === 'deviceType') {
    const records = await prisma.deviceType.findMany({
      where: { isActive: true, ...(contains ? { name: contains } : {}) },
      orderBy: { name: 'asc' },
      take,
      select: { id: true, name: true, code: true },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.name,
      description: record.code,
      exactSourceMatch: sameText(record.name, sourceValue),
    }))
  } else if (input.field === 'model') {
    const records = await prisma.deviceModel.findMany({
      where: {
        isActive: true,
        ...(vendorId ? { vendorId } : {}),
        ...(deviceTypeId ? { deviceTypeId } : {}),
        ...(contains ? { model: contains } : {}),
      },
      orderBy: { model: 'asc' },
      take,
      select: {
        id: true,
        model: true,
        platform: true,
        vendor: { select: { name: true } },
        family: { select: { name: true } },
      },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.model,
      description: [record.vendor.name, record.family?.name, record.platform]
        .filter(Boolean)
        .join(' · '),
      exactSourceMatch: sameText(record.model, sourceValue),
    }))
  } else if (input.field === 'softwarePlatform') {
    const records = await prisma.deviceModel.findMany({
      where: {
        isActive: true,
        platform: { not: null, ...(contains ? { contains: query, mode: 'insensitive' as const } : {}) },
        ...(vendorId ? { vendorId } : {}),
      },
      orderBy: { platform: 'asc' },
      take: 100,
      select: { platform: true, vendor: { select: { name: true } } },
    })
    const unique = new Map<string, { label: string; vendor: string }>()
    for (const record of records) {
      const label = clean(record.platform)
      if (label && !unique.has(label.toLocaleLowerCase('en-US'))) {
        unique.set(label.toLocaleLowerCase('en-US'), {
          label,
          vendor: record.vendor.name,
        })
      }
    }
    choices = [...unique.values()].slice(0, take).map((record) => ({
      id: `platform:${record.label}`,
      label: record.label,
      description: record.vendor,
      exactSourceMatch: sameText(record.label, sourceValue),
    }))
  } else if (input.field === 'currentFirmware') {
    const records = await prisma.firmwareRelease.findMany({
      where: {
        isActive: true,
        ...(vendorId ? { vendorId } : {}),
        ...(platform ? { platform: { equals: platform, mode: 'insensitive' } } : {}),
        ...(query ? { version: { contains: query, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ releasedAt: 'desc' }, { version: 'desc' }],
      take,
      select: {
        id: true,
        version: true,
        platform: true,
        catalogState: true,
        vendor: { select: { name: true } },
      },
    })
    choices = records.map((record) => ({
      id: record.id,
      label: record.version,
      description: `${record.vendor.name} · ${record.platform} · ${record.catalogState}`,
      exactSourceMatch: sameText(record.version, sourceValue),
    }))
  }

  return {
    field: input.field,
    sourceValue,
    currentValue,
    searchable,
    choices: choices.toSorted(
      (left, right) =>
        Number(right.exactSourceMatch) - Number(left.exactSourceMatch) ||
        left.label.localeCompare(right.label),
    ),
  }
}
