import { AUDIT_ACTIONS } from '@/lib/audit-events'
import {
  countImportPreview,
  importResolutionKey,
  mappedRows,
  normalizeImportText,
  type DeviceImportAction,
  type DeviceImportChange,
  type DeviceImportIssue,
  type DeviceImportOptions,
  type DeviceImportPreview,
  type DeviceImportPreviewRow,
  type DeviceImportResult,
  type DeviceImportUnresolvedReference,
  DeviceImportValidationError,
} from '@/lib/device-import'
import { normalizedDeviceName, normalizedPlatform, parseDeviceInput } from '@/lib/devices'
import { prisma } from '@/lib/prisma'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'

type CustomerRef = {
  id: string
  code: string | null
  name: string
  isActive: boolean
  contractTypeId: string | null
}

type SiteRef = {
  id: string
  customerId: string
  code: string | null
  name: string
  isActive: boolean
  contractTypeId: string | null
}

type VendorRef = { id: string; code: string; name: string; isActive: boolean }
type DeviceTypeRef = { id: string; code: string; name: string; isActive: boolean }

type ModelRef = {
  id: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string | null
  isActive: boolean
  vendor: VendorRef
  deviceType: DeviceTypeRef
}

type FirmwareRef = {
  id: string
  vendorId: string
  platform: string
  version: string
  status: string
  isActive: boolean
}

type ContractRef = { id: string; code: string; name: string; isActive: boolean }
type AliasRef = {
  kind: string
  normalizedSourceValue: string
  contextKey: string
  targetId: string
}

type ExistingDevice = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  name: string
  hostname: string | null
  serialNumber: string | null
  managementAddress: string | null
  notes: string | null
  currentFirmwareReleaseId: string | null
  currentFirmwareObservedAt: Date | null
  currentFirmwareSource: string
  source: string
  externalProvider: string | null
  externalId: string | null
  isActive: boolean
  currentFirmwareRelease: { id: string; version: string } | null
}

type ReferenceSet = {
  customers: CustomerRef[]
  sites: SiteRef[]
  vendors: VendorRef[]
  deviceTypes: DeviceTypeRef[]
  models: ModelRef[]
  firmwareReleases: FirmwareRef[]
  contracts: ContractRef[]
  devices: ExistingDevice[]
  aliases: AliasRef[]
}

type PlannedRow = DeviceImportPreviewRow & {
  input: ReturnType<typeof parseDeviceInput> | null
  existing: ExistingDevice | null
  currentFirmwareVersion: string | null
  firmwareMapped: boolean
}

type ImportPlan = {
  preview: DeviceImportPreview
  rows: PlannedRow[]
}

function exactNameOrCode<T extends { name: string; code?: string | null }>(value: string, records: T[]) {
  const normalized = normalizeImportText(value)
  return records.filter(
    (record) => normalizeImportText(record.name) === normalized || normalizeImportText(record.code) === normalized,
  )
}

function uniqueMatch<T>(
  value: string,
  records: T[],
  matcher: (record: T) => boolean,
  label: string,
  issues: DeviceImportIssue[],
) {
  const matches = records.filter(matcher)
  if (matches.length === 0) {
    issues.push({ level: 'error', message: `${label} “${value}” was not found.` })
    return null
  }
  if (matches.length > 1) {
    issues.push({ level: 'error', message: `${label} “${value}” matches multiple configured records.` })
    return null
  }
  return matches[0]
}

function activeReference<T extends { isActive: boolean }>(record: T | null, label: string, issues: DeviceImportIssue[]) {
  if (record && !record.isActive) issues.push({ level: 'error', message: `${label} is archived and cannot be selected for a new import mapping.` })
  return record
}

function displayModel(model: ModelRef | null) {
  return model ? `${model.vendor.name} · ${model.model}` : null
}

function displaySite(site: SiteRef | null) {
  return site?.name ?? null
}

function addChange(changes: DeviceImportChange[], field: string, label: string, before: unknown, after: unknown) {
  const beforeText = before === null || before === undefined || before === '' ? null : String(before)
  const afterText = after === null || after === undefined || after === '' ? null : String(after)
  if (beforeText !== afterText) changes.push({ field, label, before: beforeText, after: afterText })
}

function publicRow(row: PlannedRow): DeviceImportPreviewRow {
  return {
    rowNumber: row.rowNumber,
    action: row.action,
    importable: row.importable,
    existingDeviceId: row.existingDeviceId,
    identity: row.identity,
    customer: row.customer,
    site: row.site,
    model: row.model,
    currentFirmware: row.currentFirmware,
    issues: row.issues,
    changes: row.changes,
  }
}

async function loadReferences(): Promise<ReferenceSet> {
  const [customers, sites, vendors, deviceTypes, models, firmwareReleases, contracts, devices, aliases] = await Promise.all([
    prisma.customer.findMany({
      select: { id: true, code: true, name: true, isActive: true, contractTypeId: true },
    }),
    prisma.site.findMany({
      select: { id: true, customerId: true, code: true, name: true, isActive: true, contractTypeId: true },
    }),
    prisma.vendor.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    prisma.deviceType.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    prisma.deviceModel.findMany({
      select: {
        id: true,
        vendorId: true,
        deviceTypeId: true,
        model: true,
        platform: true,
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
        deviceType: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    prisma.firmwareRelease.findMany({
      select: { id: true, vendorId: true, platform: true, version: true, status: true, isActive: true },
    }),
    prisma.contractType.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    prisma.device.findMany({
      select: {
        id: true,
        customerId: true,
        siteId: true,
        deviceModelId: true,
        name: true,
        hostname: true,
        serialNumber: true,
        managementAddress: true,
        notes: true,
        currentFirmwareReleaseId: true,
        currentFirmwareObservedAt: true,
        currentFirmwareSource: true,
        source: true,
        externalProvider: true,
        externalId: true,
        isActive: true,
        currentFirmwareRelease: { select: { id: true, version: true } },
      },
    }),
    prisma.importReferenceAlias.findMany({
      select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true },
    }),
  ])

  return { customers, sites, vendors, deviceTypes, models, firmwareReleases, contracts, devices, aliases }
}

function aliasTargetId(kind: 'DEVICE_TYPE' | 'DEVICE_MODEL', value: string, contextKey: string, options: DeviceImportOptions, references: ReferenceSet) {
  const key = importResolutionKey(kind, value, contextKey)
  const oneTime = options.resolutions[key]
  if (oneTime) return oneTime
  return references.aliases.find(
    (alias) =>
      alias.kind === kind &&
      alias.normalizedSourceValue === normalizeImportText(value) &&
      alias.contextKey === contextKey,
  )?.targetId ?? null
}

function unresolvedIssue(
  kind: 'DEVICE_TYPE' | 'DEVICE_MODEL',
  value: string,
  contextKey: string,
  message: string,
): DeviceImportIssue {
  return {
    level: 'error',
    message,
    reference: { kind, sourceValue: value, contextKey },
  }
}

function resolveExternalMatch(
  provider: string | null,
  externalId: string | null,
  devices: ExistingDevice[],
  issues: DeviceImportIssue[],
) {
  if (!externalId) return null
  if (!provider) {
    issues.push({
      level: 'warning',
      message: 'External ID is present without an external provider, so it cannot be used as the deterministic match key.',
    })
    return null
  }
  const normalizedProvider = normalizeImportText(provider)
  const normalizedId = normalizeImportText(externalId)
  const matches = devices.filter(
    (device) =>
      normalizeImportText(device.externalProvider) === normalizedProvider && normalizeImportText(device.externalId) === normalizedId,
  )
  if (matches.length > 1) {
    issues.push({ level: 'error', message: 'External provider + ID matches multiple existing devices.' })
    return null
  }
  return matches[0] ?? null
}

function resolveFallbackMatch(
  customerId: string,
  rawName: string | null,
  hostname: string | null,
  devices: ExistingDevice[],
  issues: DeviceImportIssue[],
) {
  const matches = new Map<string, ExistingDevice>()
  if (rawName) {
    const normalized = normalizedDeviceName(rawName)
    for (const device of devices) {
      if (device.customerId === customerId && normalizedDeviceName(device.name) === normalized) matches.set(device.id, device)
    }
  }
  if (hostname) {
    const normalized = normalizeImportText(hostname)
    for (const device of devices) {
      if (device.customerId === customerId && normalizeImportText(device.hostname) === normalized) matches.set(device.id, device)
    }
  }
  if (matches.size > 1) {
    issues.push({ level: 'error', message: 'Device name/hostname identifies more than one existing device.' })
    return null
  }
  return [...matches.values()][0] ?? null
}

function resolveCustomer(
  rawCustomer: string | null,
  defaultCustomerId: string | null,
  existing: ExistingDevice | null,
  references: ReferenceSet,
  issues: DeviceImportIssue[],
) {
  if (rawCustomer) {
    const match = uniqueMatch(
      rawCustomer,
      references.customers,
      (record) => exactNameOrCode(rawCustomer, [record]).length === 1,
      'Customer',
      issues,
    )
    return activeReference(match, 'Customer', issues)
  }
  if (defaultCustomerId) {
    const match = references.customers.find((record) => record.id === defaultCustomerId) ?? null
    if (!match) issues.push({ level: 'error', message: 'The selected default customer no longer exists.' })
    return activeReference(match, 'Default customer', issues)
  }
  if (existing) return references.customers.find((record) => record.id === existing.customerId) ?? null
  issues.push({ level: 'error', message: 'Customer is required. Map a customer column or choose a file-level default.' })
  return null
}

function resolveSite(
  rawSite: string | null,
  defaultSiteId: string | null,
  customer: CustomerRef,
  existing: ExistingDevice | null,
  references: ReferenceSet,
  issues: DeviceImportIssue[],
) {
  if (rawSite) {
    const matches = exactNameOrCode(rawSite, references.sites.filter((site) => site.customerId === customer.id))
    if (matches.length === 0) {
      issues.push({ level: 'error', message: `Site/location “${rawSite}” was not found for ${customer.name}.` })
      return null
    }
    if (matches.length > 1) {
      issues.push({ level: 'error', message: `Site/location “${rawSite}” is ambiguous for ${customer.name}.` })
      return null
    }
    return activeReference(matches[0], 'Site/location', issues)
  }
  if (defaultSiteId) {
    const site = references.sites.find((record) => record.id === defaultSiteId) ?? null
    if (!site) {
      issues.push({ level: 'error', message: 'The selected default site no longer exists.' })
      return null
    }
    if (site.customerId !== customer.id) {
      issues.push({ level: 'error', message: 'The selected default site belongs to another customer.' })
      return null
    }
    return activeReference(site, 'Default site', issues)
  }
  if (existing?.siteId) return references.sites.find((record) => record.id === existing.siteId) ?? null
  return null
}

function resolveVendor(value: string | null, references: ReferenceSet, issues: DeviceImportIssue[]) {
  if (!value) return null
  const matches = exactNameOrCode(value, references.vendors)
  if (matches.length === 0) {
    issues.push({ level: 'error', message: `Vendor “${value}” was not found.` })
    return null
  }
  if (matches.length > 1) {
    issues.push({ level: 'error', message: `Vendor “${value}” is ambiguous.` })
    return null
  }
  return activeReference(matches[0], 'Vendor', issues)
}

function resolveDeviceType(value: string | null, references: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (!value) return null
  const targetId = aliasTargetId('DEVICE_TYPE', value, '', options, references)
  if (targetId) {
    const target = references.deviceTypes.find((record) => record.id === targetId) ?? null
    if (!target) {
      issues.push(unresolvedIssue('DEVICE_TYPE', value, '', `The remembered device type mapping for “${value}” points to a record that no longer exists.`))
      return null
    }
    return activeReference(target, 'Device type', issues)
  }

  const matches = exactNameOrCode(value, references.deviceTypes)
  if (matches.length === 0) {
    issues.push(unresolvedIssue('DEVICE_TYPE', value, '', `Device type “${value}” was not found.`))
    return null
  }
  if (matches.length > 1) {
    issues.push(unresolvedIssue('DEVICE_TYPE', value, '', `Device type “${value}” is ambiguous.`))
    return null
  }
  return activeReference(matches[0], 'Device type', issues)
}

function resolveModel(
  rawModel: string | null,
  vendor: VendorRef | null,
  deviceType: DeviceTypeRef | null,
  existing: ExistingDevice | null,
  references: ReferenceSet,
  options: DeviceImportOptions,
  issues: DeviceImportIssue[],
) {
  if (!rawModel) {
    if (!existing) {
      issues.push({ level: 'error', message: 'Device model is required for a new device.' })
      return null
    }
    const model = references.models.find((record) => record.id === existing.deviceModelId) ?? null
    if (!model) issues.push({ level: 'error', message: 'The existing device model no longer exists.' })
    if (vendor && model && model.vendorId !== vendor.id) {
      issues.push({ level: 'error', message: 'Mapped vendor does not match the existing device model.' })
    }
    if (deviceType && model && model.deviceTypeId !== deviceType.id) {
      issues.push({ level: 'error', message: 'Mapped device type does not match the existing device model.' })
    }
    return model
  }

  const contextKey = vendor?.id ?? ''
  const targetId = aliasTargetId('DEVICE_MODEL', rawModel, contextKey, options, references)
  if (targetId) {
    const target = references.models.find((record) => record.id === targetId) ?? null
    if (!target) {
      issues.push(unresolvedIssue('DEVICE_MODEL', rawModel, contextKey, `The remembered model mapping for “${rawModel}” points to a record that no longer exists.`))
      return null
    }
    if (vendor && target.vendorId !== vendor.id) {
      issues.push(unresolvedIssue('DEVICE_MODEL', rawModel, contextKey, `The selected model for “${rawModel}” belongs to another vendor.`))
      return null
    }
    if (deviceType && target.deviceTypeId !== deviceType.id) {
      issues.push(unresolvedIssue('DEVICE_MODEL', rawModel, contextKey, `The selected model for “${rawModel}” has a different device type.`))
      return null
    }
    return activeReference(target, 'Device model', issues)
  }

  const normalizedModel = normalizeImportText(rawModel)
  const candidates = references.models.filter(
    (model) =>
      normalizeImportText(model.model) === normalizedModel &&
      (!vendor || model.vendorId === vendor.id) &&
      (!deviceType || model.deviceTypeId === deviceType.id),
  )
  if (candidates.length === 0) {
    issues.push(unresolvedIssue('DEVICE_MODEL', rawModel, contextKey, `Concrete device model “${rawModel}” was not found for the mapped vendor/type.`))
    return null
  }
  if (candidates.length > 1) {
    issues.push(unresolvedIssue('DEVICE_MODEL', rawModel, contextKey, `Concrete device model “${rawModel}” is ambiguous. Choose the concrete model to use.`))
    return null
  }
  return activeReference(candidates[0], 'Device model', issues)
}

function resolveFirmware(
  value: string | null,
  model: ModelRef | null,
  existing: ExistingDevice | null,
  references: ReferenceSet,
  issues: DeviceImportIssue[],
) {
  if (!value) {
    if (!existing?.currentFirmwareReleaseId) return null
    return references.firmwareReleases.find((release) => release.id === existing.currentFirmwareReleaseId) ?? null
  }
  if (!model) return null
  const normalizedVersion = normalizeImportText(value)
  const candidates = references.firmwareReleases.filter(
    (release) =>
      release.vendorId === model.vendorId &&
      normalizeImportText(release.version) === normalizedVersion &&
      (!model.platform || normalizedPlatform(release.platform) === normalizedPlatform(model.platform)),
  )
  if (candidates.length === 0) {
    issues.push({
      level: 'error',
      message: `Current firmware “${value}” is not present in the compatible firmware catalog for this concrete model.`,
    })
    return null
  }
  if (candidates.length > 1) {
    issues.push({ level: 'error', message: `Current firmware “${value}” matches multiple compatible catalog releases.` })
    return null
  }
  return candidates[0]
}

function validateContract(
  value: string | null,
  customer: CustomerRef | null,
  site: SiteRef | null,
  references: ReferenceSet,
  issues: DeviceImportIssue[],
) {
  if (!value || !customer) return
  const matches = exactNameOrCode(value, references.contracts)
  if (matches.length === 0) {
    issues.push({ level: 'error', message: `Contract type “${value}” was not found.` })
    return
  }
  if (matches.length > 1) {
    issues.push({ level: 'error', message: `Contract type “${value}” is ambiguous.` })
    return
  }
  const effectiveContractId = site?.contractTypeId ?? customer.contractTypeId
  if (!effectiveContractId) {
    issues.push({ level: 'error', message: `Contract type “${value}” is supplied, but this customer/site has no effective contract.` })
    return
  }
  if (matches[0].id !== effectiveContractId) {
    issues.push({
      level: 'error',
      message: `Contract type “${value}” does not match the effective customer/site contract. Device import never changes contract assignments.`,
    })
  }
}

function buildChanges(
  existing: ExistingDevice,
  input: ReturnType<typeof parseDeviceInput>,
  customer: CustomerRef,
  site: SiteRef | null,
  model: ModelRef,
  firmware: FirmwareRef | null,
  references: ReferenceSet,
) {
  const changes: DeviceImportChange[] = []
  const oldCustomer = references.customers.find((record) => record.id === existing.customerId) ?? null
  const oldSite = existing.siteId ? references.sites.find((record) => record.id === existing.siteId) ?? null : null
  const oldModel = references.models.find((record) => record.id === existing.deviceModelId) ?? null
  addChange(changes, 'customer', 'Customer', oldCustomer?.name, customer.name)
  addChange(changes, 'site', 'Site/location', displaySite(oldSite), displaySite(site))
  addChange(changes, 'model', 'Device model', displayModel(oldModel), displayModel(model))
  addChange(changes, 'name', 'Device name', existing.name, input.name)
  addChange(changes, 'hostname', 'Hostname', existing.hostname, input.hostname)
  addChange(changes, 'serialNumber', 'Serial number', existing.serialNumber, input.serialNumber)
  addChange(changes, 'managementAddress', 'Management address', existing.managementAddress, input.managementAddress)
  addChange(changes, 'currentFirmware', 'Current firmware', existing.currentFirmwareRelease?.version, firmware?.version)
  addChange(changes, 'externalProvider', 'External provider', existing.externalProvider, input.externalProvider)
  addChange(changes, 'externalId', 'External ID', existing.externalId, input.externalId)
  addChange(changes, 'notes', 'Notes', existing.notes, input.notes)
  return changes
}

function conflictRow(row: PlannedRow, message: string) {
  row.action = 'CONFLICT'
  row.importable = false
  row.issues.push({ level: 'error', message })
}

function applyBatchConflicts(rows: PlannedRow[]) {
  const byExisting = new Map<string, PlannedRow[]>()
  const byCreateName = new Map<string, PlannedRow[]>()
  const byExternalIdentity = new Map<string, PlannedRow[]>()

  for (const row of rows) {
    if (!row.input || ['ERROR', 'CONFLICT'].includes(row.action)) continue
    if (row.existingDeviceId) {
      const group = byExisting.get(row.existingDeviceId) ?? []
      group.push(row)
      byExisting.set(row.existingDeviceId, group)
    } else if (row.action === 'CREATE') {
      const key = `${row.input.customerId}:${normalizedDeviceName(row.input.name)}`
      const group = byCreateName.get(key) ?? []
      group.push(row)
      byCreateName.set(key, group)
    }

    if (row.input.externalProvider && row.input.externalId) {
      const key = `${normalizeImportText(row.input.externalProvider)}:${normalizeImportText(row.input.externalId)}`
      const group = byExternalIdentity.get(key) ?? []
      group.push(row)
      byExternalIdentity.set(key, group)
    }
  }

  for (const group of byExisting.values()) {
    if (group.length > 1) group.forEach((row) => conflictRow(row, 'Multiple spreadsheet rows target the same existing device.'))
  }
  for (const group of byCreateName.values()) {
    if (group.length > 1) group.forEach((row) => conflictRow(row, 'Multiple spreadsheet rows would create the same customer-scoped device name.'))
  }
  for (const group of byExternalIdentity.values()) {
    if (group.length > 1) group.forEach((row) => conflictRow(row, 'External provider + ID is duplicated within the selected spreadsheet rows.'))
  }
}

function unresolvedReferences(rows: PlannedRow[], references: ReferenceSet): DeviceImportUnresolvedReference[] {
  const unresolved = new Map<string, DeviceImportUnresolvedReference>()
  for (const row of rows) {
    for (const issue of row.issues) {
      if (!issue.reference) continue
      const key = importResolutionKey(issue.reference.kind, issue.reference.sourceValue, issue.reference.contextKey)
      const current = unresolved.get(key)
      if (current) {
        if (!current.rowNumbers.includes(row.rowNumber)) current.rowNumbers.push(row.rowNumber)
        continue
      }
      const vendor = issue.reference.contextKey
        ? references.vendors.find((candidate) => candidate.id === issue.reference?.contextKey) ?? null
        : null
      unresolved.set(key, {
        key,
        kind: issue.reference.kind,
        sourceValue: issue.reference.sourceValue,
        normalizedSourceValue: normalizeImportText(issue.reference.sourceValue),
        contextKey: issue.reference.contextKey,
        vendorId: vendor?.id ?? null,
        vendorName: vendor?.name ?? null,
        rowNumbers: [row.rowNumber],
      })
    }
  }
  return [...unresolved.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.sourceValue.localeCompare(b.sourceValue))
}

async function buildPlan(
  workbook: XlsxWorkbook,
  options: DeviceImportOptions,
  fileName: string,
  now: Date,
): Promise<ImportPlan> {
  const sheet = workbook.sheets.find((record) => record.name === options.sheetName)
  if (!sheet) throw new DeviceImportValidationError('The selected worksheet is unavailable.')
  const references = await loadReferences()
  const sourceRows = mappedRows(sheet, options)
  const rows: PlannedRow[] = []

  for (const sourceRow of sourceRows) {
    const raw = sourceRow.values
    const issues: DeviceImportIssue[] = []
    const provider = raw.externalProvider ?? options.defaults.externalProvider
    let existing = resolveExternalMatch(provider, raw.externalId, references.devices, issues)

    let customer = resolveCustomer(raw.customer, options.defaults.customerId, existing, references, issues)
    if (!existing && customer) {
      existing = resolveFallbackMatch(customer.id, raw.name, raw.hostname, references.devices, issues)
    }
    if (existing && customer && existing.customerId !== customer.id) {
      issues.push({
        level: 'error',
        message: 'The spreadsheet customer does not match the customer of the device identified by external/name/hostname identity.',
      })
    }
    if (!customer && existing) customer = references.customers.find((record) => record.id === existing.customerId) ?? null

    const site = customer
      ? resolveSite(raw.site, options.defaults.siteId, customer, existing, references, issues)
      : null
    const vendor = resolveVendor(raw.vendor, references, issues)
    const deviceType = resolveDeviceType(raw.deviceType, references, options, issues)
    const model = resolveModel(raw.model, vendor, deviceType, existing, references, options, issues)
    const firmware = resolveFirmware(raw.currentFirmware, model, existing, references, issues)
    validateContract(raw.contract, customer, site, references, issues)

    const identity = raw.name ?? raw.hostname ?? raw.externalId ?? `Spreadsheet row ${sourceRow.rowNumber}`
    let input: ReturnType<typeof parseDeviceInput> | null = null
    let changes: DeviceImportChange[] = []

    if (customer && model && !issues.some((issue) => issue.level === 'error')) {
      const name = raw.name ?? (existing ? existing.name : raw.hostname ?? '')
      try {
        input = parseDeviceInput({
          customerId: customer.id,
          siteId: site?.id ?? null,
          deviceModelId: model.id,
          name,
          hostname: raw.hostname ?? existing?.hostname ?? null,
          serialNumber: raw.serialNumber ?? existing?.serialNumber ?? null,
          managementAddress: raw.managementAddress ?? existing?.managementAddress ?? null,
          notes: raw.notes ?? existing?.notes ?? null,
          currentFirmwareReleaseId: firmware?.id ?? null,
          currentFirmwareObservedAt: raw.currentFirmware ? now.toISOString() : existing?.currentFirmwareObservedAt?.toISOString() ?? null,
          currentFirmwareSource: raw.currentFirmware ? 'IMPORT' : existing?.currentFirmwareSource ?? 'IMPORT',
          source: 'IMPORT',
          externalProvider: provider ?? existing?.externalProvider ?? null,
          externalId: raw.externalId ?? existing?.externalId ?? null,
          isActive: existing?.isActive ?? true,
        })
      } catch (error) {
        if (error instanceof Error) issues.push({ level: 'error', message: error.message })
        else issues.push({ level: 'error', message: 'The mapped row is not a valid device record.' })
      }
    }

    if (input) {
      const sameNameDevice = references.devices.find(
        (device) =>
          device.customerId === input.customerId &&
          device.id !== existing?.id &&
          normalizedDeviceName(device.name) === normalizedDeviceName(input.name),
      )
      if (sameNameDevice) {
        issues.push({ level: 'error', message: `Device name “${input.name}” is already used by another device for this customer.` })
      }
    }

    if (existing && input && customer && model) {
      changes = buildChanges(existing, input, customer, site, model, firmware, references)
    }

    const hasErrors = issues.some((issue) => issue.level === 'error')
    const action: DeviceImportAction = hasErrors ? 'ERROR' : existing ? (changes.length > 0 ? 'UPDATE' : 'UNCHANGED') : 'CREATE'

    rows.push({
      rowNumber: sourceRow.rowNumber,
      action,
      importable: action === 'CREATE' || action === 'UPDATE',
      existingDeviceId: existing?.id ?? null,
      identity,
      customer: customer?.name ?? null,
      site: site?.name ?? null,
      model: displayModel(model),
      currentFirmware: firmware?.version ?? null,
      issues,
      changes,
      input,
      existing,
      currentFirmwareVersion: firmware?.version ?? null,
      firmwareMapped: Boolean(raw.currentFirmware),
    })
  }

  applyBatchConflicts(rows)
  const publicRows = rows.map(publicRow)
  return {
    rows,
    preview: {
      fileName,
      sheetName: options.sheetName,
      headerRow: options.headerRow,
      rows: publicRows,
      unresolvedReferences: unresolvedReferences(rows, references),
      counts: countImportPreview(publicRows),
    },
  }
}

export async function previewDeviceImport(
  workbook: XlsxWorkbook,
  options: DeviceImportOptions,
  fileName: string,
) {
  return (await buildPlan(workbook, options, fileName, new Date())).preview
}

function parseSelectedRows(value: unknown) {
  if (!Array.isArray(value)) throw new DeviceImportValidationError('Choose one or more preview rows to import.')
  const rows = [...new Set(value.map(Number).filter((row) => Number.isInteger(row) && row > 0))]
  if (rows.length === 0) throw new DeviceImportValidationError('Choose one or more preview rows to import.')
  return rows
}

export async function commitDeviceImport(
  workbook: XlsxWorkbook,
  options: DeviceImportOptions,
  selectedRowsValue: unknown,
  fileName: string,
  actorUserId: string | null,
): Promise<DeviceImportResult> {
  const selectedRows = parseSelectedRows(selectedRowsValue)
  const now = new Date()
  const plan = await buildPlan(workbook, options, fileName, now)
  const selectedSet = new Set(selectedRows)
  const selected = plan.rows.filter((row) => selectedSet.has(row.rowNumber))

  if (selected.length !== selectedRows.length) {
    throw new DeviceImportValidationError('One or more selected spreadsheet rows are no longer present. Refresh the preview.')
  }
  const stale = selected.find((row) => !row.importable || !row.input || !['CREATE', 'UPDATE'].includes(row.action))
  if (stale) {
    throw new DeviceImportValidationError(`Spreadsheet row ${stale.rowNumber} is no longer importable. Refresh the preview before importing.`)
  }

  await prisma.$transaction(async (tx) => {
    for (const row of selected) {
      const input = row.input!
      const data = { ...input, lastSynchronizedAt: now }

      if (row.action === 'CREATE') {
        const created = await tx.device.create({ data, select: { id: true } })
        if (input.currentFirmwareReleaseId) {
          await tx.auditEvent.create({
            data: {
              actorUserId,
              customerId: input.customerId,
              action: AUDIT_ACTIONS.currentFirmwareChanged,
              entityType: 'Device',
              entityId: created.id,
              before: { firmwareReleaseId: null, version: null, observedAt: null, source: null },
              after: {
                firmwareReleaseId: input.currentFirmwareReleaseId,
                version: row.currentFirmwareVersion,
                observedAt: input.currentFirmwareObservedAt?.toISOString() ?? null,
                source: input.currentFirmwareSource,
              },
              metadata: {
                context: 'XLSX_IMPORT_CREATE',
                fileName,
                sheetName: options.sheetName,
                rowNumber: row.rowNumber,
              },
            },
          })
        }
        continue
      }

      const existing = row.existing!
      await tx.device.update({ where: { id: existing.id }, data })
      if (row.firmwareMapped) {
        await tx.auditEvent.create({
          data: {
            actorUserId,
            customerId: input.customerId,
            action: AUDIT_ACTIONS.currentFirmwareChanged,
            entityType: 'Device',
            entityId: existing.id,
            before: {
              firmwareReleaseId: existing.currentFirmwareReleaseId,
              version: existing.currentFirmwareRelease?.version ?? null,
              observedAt: existing.currentFirmwareObservedAt?.toISOString() ?? null,
              source: existing.currentFirmwareSource,
            },
            after: {
              firmwareReleaseId: input.currentFirmwareReleaseId,
              version: row.currentFirmwareVersion,
              observedAt: input.currentFirmwareObservedAt?.toISOString() ?? null,
              source: input.currentFirmwareSource,
            },
            metadata: {
              context: 'XLSX_IMPORT_UPDATE',
              fileName,
              sheetName: options.sheetName,
              rowNumber: row.rowNumber,
            },
          },
        })
      }
    }
  })

  const created = selected.filter((row) => row.action === 'CREATE').length
  const updated = selected.filter((row) => row.action === 'UPDATE').length
  const failed = plan.rows.filter((row) => row.action === 'ERROR' || row.action === 'CONFLICT').length
  const skipped =
    plan.rows.filter((row) => row.action === 'UNCHANGED').length +
    plan.rows.filter((row) => row.importable && !selectedSet.has(row.rowNumber)).length

  return {
    created,
    updated,
    skipped,
    failed,
    importedRows: selected.map((row) => row.rowNumber),
  }
}
