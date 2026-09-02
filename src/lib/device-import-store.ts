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
  type DeviceImportReferenceIssue,
  type DeviceImportReferenceKind,
  type DeviceImportResult,
  type DeviceImportUnresolvedReference,
  DeviceImportValidationError,
} from '@/lib/device-import'
import { normalizedDeviceName, normalizedPlatform, parseDeviceInput } from '@/lib/devices'
import { prisma } from '@/lib/prisma'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'

type CustomerRef = { id: string; code: string | null; name: string; isActive: boolean; contractTypeId: string | null }
type SiteRef = { id: string; customerId: string; code: string | null; name: string; isActive: boolean; contractTypeId: string | null }
type VendorRef = { id: string; code: string; name: string; isActive: boolean }
type DeviceTypeRef = { id: string; code: string; name: string; isActive: boolean }
type ModelRef = {
  id: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string | null
  supportedPlatforms: Array<{ platform: string }>
  isActive: boolean
  vendor: VendorRef
  deviceType: DeviceTypeRef
}
type FirmwareRef = { id: string; vendorId: string; platform: string; version: string; status: string; isActive: boolean }
type ContractRef = { id: string; code: string; name: string; isActive: boolean }
type AliasRef = { kind: string; normalizedSourceValue: string; contextKey: string; targetId: string }

type ExistingDevice = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  platform: string | null
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
  currentFirmwareRelease: { id: string; version: string; platform: string } | null
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
  globalAliases: AliasRef[]
  profileAliases: AliasRef[]
}

type PlannedRow = DeviceImportPreviewRow & {
  input: ReturnType<typeof parseDeviceInput> | null
  existing: ExistingDevice | null
  currentFirmwareVersion: string | null
  firmwareMapped: boolean
}

type ImportPlan = { preview: DeviceImportPreview; rows: PlannedRow[] }
type ImportSelection = { mode: 'ALL_IMPORTABLE'; rows: number[] } | { mode: 'ROWS'; rows: number[] }

const SERVER_PREVIEW_ROW_LIMIT = 200
const RESULT_ROW_SAMPLE_LIMIT = 200

function exactNameOrCode<T extends { name: string; code?: string | null }>(value: string, records: T[]) {
  const normalized = normalizeImportText(value)
  return records.filter((record) => normalizeImportText(record.name) === normalized || normalizeImportText(record.code) === normalized)
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

async function loadReferences(profileId: string | null): Promise<ReferenceSet> {
  const [customers, sites, vendors, deviceTypes, models, firmwareReleases, contracts, devices, globalAliases, profileAliases] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, code: true, name: true, isActive: true, contractTypeId: true } }),
    prisma.site.findMany({ select: { id: true, customerId: true, code: true, name: true, isActive: true, contractTypeId: true } }),
    prisma.vendor.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    prisma.deviceType.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    prisma.deviceModel.findMany({
      select: {
        id: true,
        vendorId: true,
        deviceTypeId: true,
        model: true,
        platform: true,
        supportedPlatforms: { select: { platform: true } },
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
        deviceType: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    prisma.firmwareRelease.findMany({ select: { id: true, vendorId: true, platform: true, version: true, status: true, isActive: true } }),
    prisma.contractType.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    prisma.device.findMany({
      select: {
        id: true,
        customerId: true,
        siteId: true,
        deviceModelId: true,
        platform: true,
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
        currentFirmwareRelease: { select: { id: true, version: true, platform: true } },
      },
    }),
    prisma.importReferenceAlias.findMany({ select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true } }),
    profileId
      ? prisma.deviceImportProfileAlias.findMany({
          where: { profileId },
          select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true },
        })
      : Promise.resolve([] as AliasRef[]),
  ])
  return { customers, sites, vendors, deviceTypes, models, firmwareReleases, contracts, devices, globalAliases, profileAliases }
}

function aliasTargetId(
  kind: DeviceImportReferenceKind,
  value: string,
  contextKey: string,
  options: DeviceImportOptions,
  references: ReferenceSet,
) {
  const key = importResolutionKey(kind, value, contextKey)
  const oneTime = options.resolutions[key]
  if (oneTime) return oneTime
  const normalizedSourceValue = normalizeImportText(value)
  const matches = (aliases: AliasRef[]) => aliases.find(
    (alias) => alias.kind === kind && alias.normalizedSourceValue === normalizedSourceValue && alias.contextKey === contextKey,
  )?.targetId ?? null
  return options.profileId ? matches(references.profileAliases) : matches(references.globalAliases)
}

function unresolvedIssue(
  kind: DeviceImportReferenceKind,
  value: string,
  contextKey: string,
  message: string,
  metadata: Partial<DeviceImportReferenceIssue> = {},
): DeviceImportIssue {
  return { level: 'error', message, reference: { kind, sourceValue: value, contextKey, ...metadata } }
}

function resolveExternalMatch(provider: string | null, externalId: string | null, devices: ExistingDevice[], issues: DeviceImportIssue[]) {
  if (!externalId) return null
  if (!provider) {
    issues.push({ level: 'warning', message: 'External ID is present without an external provider, so it cannot be used as the deterministic match key.' })
    return null
  }
  const matches = devices.filter((device) =>
    normalizeImportText(device.externalProvider) === normalizeImportText(provider) &&
    normalizeImportText(device.externalId) === normalizeImportText(externalId),
  )
  if (matches.length > 1) {
    issues.push({ level: 'error', message: 'External provider + ID matches multiple existing devices.' })
    return null
  }
  return matches[0] ?? null
}

function resolveFallbackMatch(customerId: string, rawName: string | null, hostname: string | null, devices: ExistingDevice[], issues: DeviceImportIssue[]) {
  const matches = new Map<string, ExistingDevice>()
  if (rawName) {
    const normalized = normalizedDeviceName(rawName)
    for (const device of devices) if (device.customerId === customerId && normalizedDeviceName(device.name) === normalized) matches.set(device.id, device)
  }
  if (hostname) {
    const normalized = normalizeImportText(hostname)
    for (const device of devices) if (device.customerId === customerId && normalizeImportText(device.hostname) === normalized) matches.set(device.id, device)
  }
  if (matches.size > 1) {
    issues.push({ level: 'error', message: 'Device name/hostname identifies more than one existing device.' })
    return null
  }
  return [...matches.values()][0] ?? null
}

function resolveCustomer(raw: string | null, defaultId: string | null, existing: ExistingDevice | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (raw) {
    const targetId = aliasTargetId('CUSTOMER', raw, '', options, refs)
    if (targetId) {
      const target = refs.customers.find((record) => record.id === targetId) ?? null
      if (!target) issues.push(unresolvedIssue('CUSTOMER', raw, '', `The remembered customer mapping for “${raw}” points to a record that no longer exists.`))
      return activeReference(target, 'Customer', issues)
    }
    const matches = exactNameOrCode(raw, refs.customers)
    if (matches.length === 1) return activeReference(matches[0], 'Customer', issues)
    issues.push(unresolvedIssue('CUSTOMER', raw, '', matches.length ? `Customer “${raw}” is ambiguous.` : `Customer “${raw}” was not found.`))
    return null
  }
  if (defaultId) {
    const target = refs.customers.find((record) => record.id === defaultId) ?? null
    if (!target) issues.push({ level: 'error', message: 'The selected default customer no longer exists.' })
    return activeReference(target, 'Default customer', issues)
  }
  if (existing) return refs.customers.find((record) => record.id === existing.customerId) ?? null
  issues.push({ level: 'error', message: 'Customer is required. Map a customer/organization column or choose a file-level default.' })
  return null
}

function resolveSite(raw: string | null, defaultId: string | null, customer: CustomerRef, existing: ExistingDevice | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (raw) {
    const contextKey = customer.id
    const targetId = aliasTargetId('SITE', raw, contextKey, options, refs)
    if (targetId) {
      const target = refs.sites.find((record) => record.id === targetId && record.customerId === customer.id) ?? null
      if (!target) issues.push(unresolvedIssue('SITE', raw, contextKey, `The remembered site mapping for “${raw}” is unavailable for ${customer.name}.`, { customerId: customer.id, customerName: customer.name }))
      return activeReference(target, 'Site/location', issues)
    }
    const matches = exactNameOrCode(raw, refs.sites.filter((site) => site.customerId === customer.id))
    if (matches.length === 1) return activeReference(matches[0], 'Site/location', issues)
    issues.push(unresolvedIssue('SITE', raw, contextKey, matches.length ? `Site/location “${raw}” is ambiguous for ${customer.name}.` : `Site/location “${raw}” was not found for ${customer.name}.`, { customerId: customer.id, customerName: customer.name }))
    return null
  }
  if (defaultId) {
    const target = refs.sites.find((record) => record.id === defaultId) ?? null
    if (!target) issues.push({ level: 'error', message: 'The selected default site no longer exists.' })
    else if (target.customerId !== customer.id) issues.push({ level: 'error', message: 'The selected default site belongs to another customer.' })
    return target?.customerId === customer.id ? activeReference(target, 'Default site', issues) : null
  }
  if (existing?.siteId) return refs.sites.find((record) => record.id === existing.siteId) ?? null
  return null
}

function resolveVendor(raw: string | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (!raw) return null
  const targetId = aliasTargetId('VENDOR', raw, '', options, refs)
  if (targetId) {
    const target = refs.vendors.find((record) => record.id === targetId) ?? null
    if (!target) issues.push(unresolvedIssue('VENDOR', raw, '', `The remembered vendor mapping for “${raw}” points to a record that no longer exists.`))
    return activeReference(target, 'Vendor', issues)
  }
  const matches = exactNameOrCode(raw, refs.vendors)
  if (matches.length === 1) return activeReference(matches[0], 'Vendor', issues)
  issues.push(unresolvedIssue('VENDOR', raw, '', matches.length ? `Vendor “${raw}” is ambiguous.` : `Vendor “${raw}” was not found.`))
  return null
}

function resolveDeviceType(raw: string | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (!raw) return null
  const targetId = aliasTargetId('DEVICE_TYPE', raw, '', options, refs)
  if (targetId) {
    const target = refs.deviceTypes.find((record) => record.id === targetId) ?? null
    if (!target) issues.push(unresolvedIssue('DEVICE_TYPE', raw, '', `The remembered device type mapping for “${raw}” points to a record that no longer exists.`))
    return activeReference(target, 'Device type', issues)
  }
  const matches = exactNameOrCode(raw, refs.deviceTypes)
  if (matches.length === 1) return activeReference(matches[0], 'Device type', issues)
  issues.push(unresolvedIssue('DEVICE_TYPE', raw, '', matches.length ? `Device type “${raw}” is ambiguous.` : `Device type “${raw}” was not found.`))
  return null
}

function resolveModel(raw: string | null, vendor: VendorRef | null, type: DeviceTypeRef | null, existing: ExistingDevice | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (!raw) {
    if (!existing) {
      issues.push({ level: 'error', message: 'Device model is required for a new device.' })
      return null
    }
    const model = refs.models.find((record) => record.id === existing.deviceModelId) ?? null
    if (!model) issues.push({ level: 'error', message: 'The existing device model no longer exists.' })
    if (vendor && model && model.vendorId !== vendor.id) issues.push({ level: 'error', message: 'Mapped vendor does not match the existing device model.' })
    if (type && model && model.deviceTypeId !== type.id) issues.push({ level: 'error', message: 'Mapped device type does not match the existing device model.' })
    return model
  }
  const contextKey = vendor?.id ?? ''
  const metadata = { vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? null }
  const targetId = aliasTargetId('DEVICE_MODEL', raw, contextKey, options, refs)
  if (targetId) {
    const target = refs.models.find((record) => record.id === targetId) ?? null
    if (!target || (vendor && target.vendorId !== vendor.id) || (type && target.deviceTypeId !== type.id)) {
      issues.push(unresolvedIssue('DEVICE_MODEL', raw, contextKey, `The selected model for “${raw}” is no longer compatible with the mapped vendor/type.`, metadata))
      return null
    }
    return activeReference(target, 'Device model', issues)
  }
  const candidates = refs.models.filter((model) =>
    normalizeImportText(model.model) === normalizeImportText(raw) &&
    (!vendor || model.vendorId === vendor.id) &&
    (!type || model.deviceTypeId === type.id),
  )
  if (candidates.length === 1) return activeReference(candidates[0], 'Device model', issues)
  issues.push(unresolvedIssue('DEVICE_MODEL', raw, contextKey, candidates.length ? `Concrete device model “${raw}” is ambiguous.` : `Concrete device model “${raw}” was not found for the mapped vendor/type.`, metadata))
  return null
}

function supportedPlatforms(model: ModelRef) {
  const result = new Map<string, string>()
  if (model.platform) result.set(normalizedPlatform(model.platform), model.platform)
  for (const entry of model.supportedPlatforms) result.set(normalizedPlatform(entry.platform), entry.platform)
  result.delete('')
  return result
}

function preliminaryDevicePlatform(rawPlatform: string | null, model: ModelRef | null, existing: ExistingDevice | null) {
  if (rawPlatform) return rawPlatform
  if (existing?.platform) return existing.platform
  if (!model) return null
  const supported = supportedPlatforms(model)
  return supported.size === 1 ? [...supported.values()][0] : null
}

function firmwareContext(model: ModelRef, platform: string | null) {
  return `${model.vendorId}|${normalizedPlatform(platform ?? '')}`
}

function resolveFirmware(raw: string | null, devicePlatform: string | null, model: ModelRef | null, existing: ExistingDevice | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (!raw) {
    if (!existing?.currentFirmwareReleaseId) return null
    return refs.firmwareReleases.find((release) => release.id === existing.currentFirmwareReleaseId) ?? null
  }
  if (!model) return null
  const supported = supportedPlatforms(model)
  const contextKey = firmwareContext(model, devicePlatform)
  const metadata = { vendorId: model.vendorId, vendorName: model.vendor.name, platform: devicePlatform, modelName: model.model }
  const compatiblePlatform = (release: FirmwareRef) => {
    const normalized = normalizedPlatform(release.platform)
    if (devicePlatform) return normalized === normalizedPlatform(devicePlatform)
    return supported.size === 0 || supported.has(normalized)
  }
  const targetId = aliasTargetId('FIRMWARE_RELEASE', raw, contextKey, options, refs)
  if (targetId) {
    const target = refs.firmwareReleases.find((release) => release.id === targetId) ?? null
    if (!target || target.vendorId !== model.vendorId || !compatiblePlatform(target)) {
      issues.push(unresolvedIssue('FIRMWARE_RELEASE', raw, contextKey, `The remembered firmware mapping for “${raw}” is no longer compatible with ${model.model}.`, metadata))
      return null
    }
    return activeReference(target, 'Firmware release', issues)
  }
  const candidates = refs.firmwareReleases.filter((release) =>
    release.vendorId === model.vendorId &&
    normalizeImportText(release.version) === normalizeImportText(raw) &&
    compatiblePlatform(release),
  )
  if (candidates.length === 1) return activeReference(candidates[0], 'Firmware release', issues)
  issues.push(unresolvedIssue('FIRMWARE_RELEASE', raw, contextKey, candidates.length ? `Current firmware “${raw}” matches multiple compatible platform releases. Choose the Device platform or Release.` : `Current firmware “${raw}” is not present in the compatible firmware catalog for this concrete model.`, metadata))
  return null
}

function resolveDevicePlatform(
  rawPlatform: string | null,
  model: ModelRef | null,
  firmware: FirmwareRef | null,
  existing: ExistingDevice | null,
  issues: DeviceImportIssue[],
) {
  if (!model) return rawPlatform ?? firmware?.platform ?? existing?.platform ?? null
  const supported = supportedPlatforms(model)
  const selected = rawPlatform ?? firmware?.platform ?? existing?.platform ?? (supported.size === 1 ? [...supported.values()][0] : null)
  if (!selected) {
    if (supported.size > 1) {
      issues.push({ level: 'error', message: `Device platform is required because ${model.model} supports multiple platforms (${[...supported.values()].join(', ')}).` })
    }
    return null
  }
  const normalized = normalizedPlatform(selected)
  if (supported.size && !supported.has(normalized)) {
    issues.push({ level: 'error', message: `Platform “${selected}” is not configured as a supported platform for ${model.model}.` })
  }
  if (firmware && normalizedPlatform(firmware.platform) !== normalized) {
    issues.push({ level: 'error', message: `Firmware ${firmware.version} belongs to ${firmware.platform}, not Device platform ${selected}.` })
  }
  return selected
}

function resolveContract(raw: string | null, customer: CustomerRef | null, site: SiteRef | null, refs: ReferenceSet, options: DeviceImportOptions, issues: DeviceImportIssue[]) {
  if (!raw || !customer) return null
  const targetId = aliasTargetId('CONTRACT_TYPE', raw, '', options, refs)
  let target: ContractRef | null = null
  if (targetId) target = refs.contracts.find((record) => record.id === targetId) ?? null
  else {
    const matches = exactNameOrCode(raw, refs.contracts)
    if (matches.length === 1) target = matches[0]
    else {
      issues.push(unresolvedIssue('CONTRACT_TYPE', raw, '', matches.length ? `Contract type “${raw}” is ambiguous.` : `Contract type “${raw}” was not found.`))
      return null
    }
  }
  if (!target) {
    issues.push(unresolvedIssue('CONTRACT_TYPE', raw, '', `The remembered contract mapping for “${raw}” points to a record that no longer exists.`))
    return null
  }
  activeReference(target, 'Contract type', issues)
  const effectiveContractId = site?.contractTypeId ?? customer.contractTypeId
  if (!effectiveContractId) issues.push({ level: 'error', message: `Contract type “${raw}” is supplied, but this customer/site has no effective contract.` })
  else if (target.id !== effectiveContractId) issues.push({ level: 'error', message: `Contract type “${raw}” does not match the effective customer/site contract. Device import never changes contract assignments.` })
  return target
}

function buildChanges(existing: ExistingDevice, input: ReturnType<typeof parseDeviceInput>, customer: CustomerRef, site: SiteRef | null, model: ModelRef, firmware: FirmwareRef | null, refs: ReferenceSet) {
  const changes: DeviceImportChange[] = []
  const oldCustomer = refs.customers.find((record) => record.id === existing.customerId) ?? null
  const oldSite = existing.siteId ? refs.sites.find((record) => record.id === existing.siteId) ?? null : null
  const oldModel = refs.models.find((record) => record.id === existing.deviceModelId) ?? null
  addChange(changes, 'customer', 'Customer', oldCustomer?.name, customer.name)
  addChange(changes, 'site', 'Site/location', displaySite(oldSite), displaySite(site))
  addChange(changes, 'model', 'Device model', displayModel(oldModel), displayModel(model))
  addChange(changes, 'platform', 'Platform', existing.platform, input.platform)
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
  const byExternal = new Map<string, PlannedRow[]>()
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
      const group = byExternal.get(key) ?? []
      group.push(row)
      byExternal.set(key, group)
    }
  }
  for (const group of byExisting.values()) if (group.length > 1) group.forEach((row) => conflictRow(row, 'Multiple spreadsheet rows target the same existing device.'))
  for (const group of byCreateName.values()) if (group.length > 1) group.forEach((row) => conflictRow(row, 'Multiple spreadsheet rows would create the same customer-scoped device name.'))
  for (const group of byExternal.values()) if (group.length > 1) group.forEach((row) => conflictRow(row, 'External provider + ID is duplicated within the selected spreadsheet rows.'))
}

function unresolvedReferences(rows: PlannedRow[]): DeviceImportUnresolvedReference[] {
  const unresolved = new Map<string, DeviceImportUnresolvedReference>()
  for (const row of rows) {
    for (const issue of row.issues) {
      if (!issue.reference) continue
      const ref = issue.reference
      const key = importResolutionKey(ref.kind, ref.sourceValue, ref.contextKey)
      const current = unresolved.get(key)
      if (current) {
        if (!current.rowNumbers.includes(row.rowNumber)) current.rowNumbers.push(row.rowNumber)
        continue
      }
      unresolved.set(key, {
        key,
        kind: ref.kind,
        sourceValue: ref.sourceValue,
        normalizedSourceValue: normalizeImportText(ref.sourceValue),
        contextKey: ref.contextKey,
        customerId: ref.customerId ?? null,
        customerName: ref.customerName ?? null,
        vendorId: ref.vendorId ?? null,
        vendorName: ref.vendorName ?? null,
        platform: ref.platform ?? null,
        modelName: ref.modelName ?? null,
        rowNumbers: [row.rowNumber],
      })
    }
  }
  return [...unresolved.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.sourceValue.localeCompare(b.sourceValue))
}

async function buildPlan(workbook: XlsxWorkbook, options: DeviceImportOptions, fileName: string, now: Date): Promise<ImportPlan> {
  const sheet = workbook.sheets.find((record) => record.name === options.sheetName)
  if (!sheet) throw new DeviceImportValidationError('The selected worksheet is unavailable.')
  const refs = await loadReferences(options.profileId)
  const sourceRows = mappedRows(sheet, options)
  const rows: PlannedRow[] = []

  for (const sourceRow of sourceRows) {
    const raw = sourceRow.values
    const issues: DeviceImportIssue[] = []
    const provider = raw.externalProvider ?? options.defaults.externalProvider
    let existing = resolveExternalMatch(provider, raw.externalId, refs.devices, issues)
    let customer = resolveCustomer(raw.customer, options.defaults.customerId, existing, refs, options, issues)
    if (!existing && customer) existing = resolveFallbackMatch(customer.id, raw.name, raw.hostname, refs.devices, issues)
    if (existing && customer && existing.customerId !== customer.id) issues.push({ level: 'error', message: 'The spreadsheet customer does not match the customer of the device identified by external/name/hostname identity.' })
    if (!customer && existing) customer = refs.customers.find((record) => record.id === existing.customerId) ?? null

    const site = customer ? resolveSite(raw.site, options.defaults.siteId, customer, existing, refs, options, issues) : null
    const vendor = resolveVendor(raw.vendor, refs, options, issues)
    const deviceType = resolveDeviceType(raw.deviceType, refs, options, issues)
    const model = resolveModel(raw.model, vendor, deviceType, existing, refs, options, issues)
    const preliminaryPlatform = preliminaryDevicePlatform(raw.platform, model, existing)
    const firmware = resolveFirmware(raw.currentFirmware, preliminaryPlatform, model, existing, refs, options, issues)
    const devicePlatform = resolveDevicePlatform(raw.platform, model, firmware, existing, issues)
    resolveContract(raw.contract, customer, site, refs, options, issues)

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
          platform: devicePlatform,
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
        issues.push({ level: 'error', message: error instanceof Error ? error.message : 'The mapped row is not a valid device record.' })
      }
    }

    if (input) {
      const sameName = refs.devices.find((device) => device.customerId === input.customerId && device.id !== existing?.id && normalizedDeviceName(device.name) === normalizedDeviceName(input.name))
      if (sameName) issues.push({ level: 'error', message: `Device name “${input.name}” is already used by another device for this customer.` })
    }
    if (existing && input && customer && model) changes = buildChanges(existing, input, customer, site, model, firmware, refs)

    const hasErrors = issues.some((issue) => issue.level === 'error')
    const action: DeviceImportAction = hasErrors ? 'ERROR' : existing ? (changes.length ? 'UPDATE' : 'UNCHANGED') : 'CREATE'
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
  const counts = countImportPreview(rows)
  return {
    rows,
    preview: {
      fileName,
      sheetName: options.sheetName,
      headerRow: options.headerRow,
      rows: rows.slice(0, SERVER_PREVIEW_ROW_LIMIT).map(publicRow),
      unresolvedReferences: unresolvedReferences(rows),
      counts,
    },
  }
}

export async function previewDeviceImport(workbook: XlsxWorkbook, options: DeviceImportOptions, fileName: string) {
  return (await buildPlan(workbook, options, fileName, new Date())).preview
}

function parseSelection(value: unknown): ImportSelection {
  if (typeof value === 'object' && value !== null && (value as { mode?: unknown }).mode === 'ALL_IMPORTABLE') {
    return { mode: 'ALL_IMPORTABLE', rows: [] }
  }
  if (!Array.isArray(value)) throw new DeviceImportValidationError('Choose one or more preview rows to import, or choose all valid rows.')
  const rows = [...new Set(value.map(Number).filter((row) => Number.isInteger(row) && row > 0))]
  if (!rows.length) throw new DeviceImportValidationError('Choose one or more preview rows to import.')
  return { mode: 'ROWS', rows }
}

export async function commitDeviceImport(workbook: XlsxWorkbook, options: DeviceImportOptions, selectedRowsValue: unknown, fileName: string, actorUserId: string | null): Promise<DeviceImportResult> {
  const selection = parseSelection(selectedRowsValue)
  const now = new Date()
  const plan = await buildPlan(workbook, options, fileName, now)
  const selected = selection.mode === 'ALL_IMPORTABLE'
    ? plan.rows.filter((row) => row.importable && row.input && ['CREATE', 'UPDATE'].includes(row.action))
    : plan.rows.filter((row) => selection.rows.includes(row.rowNumber))

  if (selection.mode === 'ROWS' && selected.length !== selection.rows.length) {
    throw new DeviceImportValidationError('One or more selected spreadsheet rows are no longer present. Refresh the preview.')
  }
  if (!selected.length) throw new DeviceImportValidationError('There are no valid CREATE/UPDATE rows selected for import.')
  const stale = selected.find((row) => !row.importable || !row.input || !['CREATE', 'UPDATE'].includes(row.action))
  if (stale) throw new DeviceImportValidationError(`Spreadsheet row ${stale.rowNumber} is no longer importable. Refresh the preview before importing.`)

  const selectedSet = new Set(selected.map((row) => row.rowNumber))
  await prisma.$transaction(async (tx) => {
    for (const row of selected) {
      const input = row.input!
      const data = { ...input, lastSynchronizedAt: now }
      if (row.action === 'CREATE') {
        const created = await tx.device.create({ data, select: { id: true } })
        if (input.currentFirmwareReleaseId) await tx.auditEvent.create({ data: {
          actorUserId,
          customerId: input.customerId,
          action: AUDIT_ACTIONS.currentFirmwareChanged,
          entityType: 'Device',
          entityId: created.id,
          before: { firmwareReleaseId: null, version: null, observedAt: null, source: null },
          after: { firmwareReleaseId: input.currentFirmwareReleaseId, version: row.currentFirmwareVersion, observedAt: input.currentFirmwareObservedAt?.toISOString() ?? null, source: input.currentFirmwareSource },
          metadata: { context: 'XLSX_IMPORT_CREATE', fileName, sheetName: options.sheetName, rowNumber: row.rowNumber, importProfileId: options.profileId, platform: input.platform },
        } })
        continue
      }
      const existing = row.existing!
      await tx.device.update({ where: { id: existing.id }, data })
      if (row.firmwareMapped) await tx.auditEvent.create({ data: {
        actorUserId,
        customerId: input.customerId,
        action: AUDIT_ACTIONS.currentFirmwareChanged,
        entityType: 'Device',
        entityId: existing.id,
        before: { firmwareReleaseId: existing.currentFirmwareReleaseId, version: existing.currentFirmwareRelease?.version ?? null, observedAt: existing.currentFirmwareObservedAt?.toISOString() ?? null, source: existing.currentFirmwareSource, platform: existing.platform },
        after: { firmwareReleaseId: input.currentFirmwareReleaseId, version: row.currentFirmwareVersion, observedAt: input.currentFirmwareObservedAt?.toISOString() ?? null, source: input.currentFirmwareSource, platform: input.platform },
        metadata: { context: 'XLSX_IMPORT_UPDATE', fileName, sheetName: options.sheetName, rowNumber: row.rowNumber, importProfileId: options.profileId },
      } })
    }
  })

  return {
    created: selected.filter((row) => row.action === 'CREATE').length,
    updated: selected.filter((row) => row.action === 'UPDATE').length,
    failed: plan.rows.filter((row) => row.action === 'ERROR' || row.action === 'CONFLICT').length,
    skipped: plan.rows.filter((row) => row.action === 'UNCHANGED').length + plan.rows.filter((row) => row.importable && !selectedSet.has(row.rowNumber)).length,
    importedRows: selected.slice(0, RESULT_ROW_SAMPLE_LIMIT).map((row) => row.rowNumber),
  }
}
