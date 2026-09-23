'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  FormField,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/ui/form-controls'
import { Modal } from '@/components/ui/modal'
import {
  deviceFormForRecord,
  deviceReleaseMatchesModel,
  type DeviceFormState,
} from '@/lib/device-form'
import type {
  DeviceDetailRecord,
  DeviceFieldErrors,
  DeviceReferenceData,
} from '@/lib/devices'

type ReferencePayload = {
  data?: DeviceReferenceData
  error?: { message?: string }
}

type SavePayload = {
  data?: DeviceDetailRecord
  error?: { message?: string; fields?: DeviceFieldErrors }
}

const EMPTY_REFERENCES: DeviceReferenceData = {
  customers: [],
  sites: [],
  models: [],
  firmwareReleases: [],
}

export function DeviceEditModal({
  device,
  onClose,
  onSaved,
}: {
  device: DeviceDetailRecord
  onClose: () => void
  onSaved: (device: DeviceDetailRecord) => void
}) {
  const [references, setReferences] =
    useState<DeviceReferenceData>(EMPTY_REFERENCES)
  const [form, setForm] = useState<DeviceFormState>(() =>
    deviceFormForRecord(device),
  )
  const [loadingReferences, setLoadingReferences] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<DeviceFieldErrors>({})

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/devices/references', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as ReferencePayload
        if (!response.ok || !payload.data)
          throw new Error(
            payload.error?.message ?? 'Device references could not be loaded.',
          )
        setReferences(payload.data)
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Device references could not be loaded.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingReferences(false)
      })

    return () => controller.abort()
  }, [])

  const selectedModel = references.models.find(
    (model) => model.id === form.deviceModelId,
  )
  const selectedCustomer = references.customers.find(
    (customer) => customer.id === form.customerId,
  )
  const selectedSite = references.sites.find((site) => site.id === form.siteId)

  const sites = useMemo(
    () =>
      references.sites.filter((site) => site.customerId === form.customerId),
    [references.sites, form.customerId],
  )
  const releases = useMemo(
    () =>
      references.firmwareReleases.filter((release) =>
        deviceReleaseMatchesModel(release, selectedModel),
      ),
    [references.firmwareReleases, selectedModel],
  )

  const effectiveContract =
    selectedSite?.contractType ?? selectedCustomer?.contractType ?? null
  const contractSource = selectedSite?.contractType
    ? 'Site override'
    : selectedCustomer?.contractType
      ? 'Customer default'
      : 'No contract'

  function changeCustomer(customerId: string) {
    const siteStillMatches = references.sites.some(
      (site) =>
        site.id === form.siteId && site.customerId === customerId,
    )
    setForm({
      ...form,
      customerId,
      siteId: siteStillMatches ? form.siteId : '',
    })
  }

  function changeModel(deviceModelId: string) {
    const model = references.models.find((item) => item.id === deviceModelId)
    const selectedRelease = references.firmwareReleases.find(
      (item) => item.id === form.currentFirmwareReleaseId,
    )
    const keepRelease = selectedRelease
      ? deviceReleaseMatchesModel(selectedRelease, model)
      : true

    setForm({
      ...form,
      deviceModelId,
      currentFirmwareReleaseId: keepRelease
        ? form.currentFirmwareReleaseId
        : '',
      currentFirmwareObservedAt: keepRelease
        ? form.currentFirmwareObservedAt
        : '',
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors({})

    try {
      const observedAt = form.currentFirmwareObservedAt
        ? new Date(form.currentFirmwareObservedAt).toISOString()
        : null

      const response = await fetch('/api/v1/devices/' + device.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          siteId: form.siteId || null,
          currentFirmwareReleaseId: form.currentFirmwareReleaseId || null,
          currentFirmwareObservedAt: observedAt,
        }),
      })
      const payload = (await response.json()) as SavePayload

      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(
          payload.error?.message ?? 'Device could not be saved.',
        )
      }

      const refresh = await fetch('/api/v1/devices/' + device.id, {
        cache: 'no-store',
      })
      const refreshed = (await refresh.json()) as SavePayload
      if (!refresh.ok || !refreshed.data)
        throw new Error(
          refreshed.error?.message ??
            'Device was saved, but the detail view could not be refreshed.',
        )

      onSaved(refreshed.data)
      onClose()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Device could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Edit device"
      wide
      busy={saving}
      onClose={onClose}
    >
      {loadingReferences ? (
        <p className="text-sm text-[var(--muted)]">
          Loading device fields…
        </p>
      ) : (
        <form onSubmit={save}>
          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-md border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Customer"
              htmlFor="device-edit-customer"
              error={fieldErrors.customerId}
            >
              <SelectInput
                id="device-edit-customer"
                value={form.customerId}
                onChange={(event) => changeCustomer(event.target.value)}
                required
              >
                <option value="">Select customer</option>
                {references.customers.map((customer) => (
                  <option
                    key={customer.id}
                    value={customer.id}
                    disabled={
                      !customer.isActive && customer.id !== form.customerId
                    }
                  >
                    {customer.name}
                    {customer.isActive ? '' : ' (archived)'}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField
              label="Site"
              htmlFor="device-edit-site"
              error={fieldErrors.siteId}
            >
              <SelectInput
                id="device-edit-site"
                value={form.siteId}
                onChange={(event) =>
                  setForm({ ...form, siteId: event.target.value })
                }
                disabled={!form.customerId}
              >
                <option value="">No site / unassigned</option>
                {sites.map((site) => (
                  <option
                    key={site.id}
                    value={site.id}
                    disabled={!site.isActive && site.id !== form.siteId}
                  >
                    {site.organizationUnit?.name
                      ? site.organizationUnit.name + ' / '
                      : ''}
                    {site.name}
                    {site.code ? ' (' + site.code + ')' : ''}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField
              label="Effective contract"
              htmlFor="device-edit-contract"
              description={contractSource}
            >
              <div
                id="device-edit-contract"
                className="flex min-h-10 items-center rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--muted-strong)]"
              >
                {effectiveContract?.name ?? 'No contract assigned'}
              </div>
            </FormField>

            <FormField
              label="Device model"
              htmlFor="device-edit-model"
              error={fieldErrors.deviceModelId}
            >
              <SelectInput
                id="device-edit-model"
                value={form.deviceModelId}
                onChange={(event) => changeModel(event.target.value)}
                required
              >
                <option value="">Select model</option>
                {references.models.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!model.isActive && model.id !== form.deviceModelId}
                  >
                    {model.vendor.name} · {model.model} ·{' '}
                    {model.deviceType.name}
                    {model.isActive ? '' : ' (archived)'}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField
              label="Device name"
              htmlFor="device-edit-name"
              error={fieldErrors.name}
            >
              <TextInput
                id="device-edit-name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
              />
            </FormField>

            <FormField
              label="Hostname"
              htmlFor="device-edit-hostname"
              error={fieldErrors.hostname}
            >
              <TextInput
                id="device-edit-hostname"
                value={form.hostname}
                onChange={(event) =>
                  setForm({ ...form, hostname: event.target.value })
                }
              />
            </FormField>

            <FormField
              label="Management address"
              htmlFor="device-edit-management"
              description="Recorded address only; reachability is not tested."
              error={fieldErrors.managementAddress}
            >
              <TextInput
                id="device-edit-management"
                value={form.managementAddress}
                onChange={(event) =>
                  setForm({
                    ...form,
                    managementAddress: event.target.value,
                  })
                }
              />
            </FormField>

            <FormField
              label="Serial number"
              htmlFor="device-edit-serial"
              error={fieldErrors.serialNumber}
            >
              <TextInput
                id="device-edit-serial"
                value={form.serialNumber}
                onChange={(event) =>
                  setForm({ ...form, serialNumber: event.target.value })
                }
              />
            </FormField>

            <FormField
              label="Current firmware"
              htmlFor="device-edit-firmware"
              error={fieldErrors.currentFirmwareReleaseId}
            >
              <SelectInput
                id="device-edit-firmware"
                value={form.currentFirmwareReleaseId}
                onChange={(event) =>
                  setForm({
                    ...form,
                    currentFirmwareReleaseId: event.target.value,
                    currentFirmwareObservedAt: event.target.value
                      ? form.currentFirmwareObservedAt
                      : '',
                  })
                }
                disabled={!form.deviceModelId}
              >
                <option value="">Unknown / not recorded</option>
                {releases.map((release) => (
                  <option key={release.id} value={release.id}>
                    {release.version} · {release.platform}
                    {release.firmwareTrain
                      ? ' · ' + release.firmwareTrain.name
                      : ''}
                    {' · ' + release.status}
                    {release.isActive ? '' : ' · archived'}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField
              label="Firmware source"
              htmlFor="device-edit-firmware-source"
              error={fieldErrors.currentFirmwareSource}
            >
              <SelectInput
                id="device-edit-firmware-source"
                value={form.currentFirmwareSource}
                onChange={(event) =>
                  setForm({
                    ...form,
                    currentFirmwareSource: event.target.value,
                  })
                }
                disabled={!form.currentFirmwareReleaseId}
              >
                <option value="MANUAL">Manual</option>
                <option value="API">API</option>
                <option value="IMPORT">Import</option>
              </SelectInput>
            </FormField>

            <FormField
              label="Observed / reported at"
              htmlFor="device-edit-firmware-observed"
              error={fieldErrors.currentFirmwareObservedAt}
            >
              <TextInput
                id="device-edit-firmware-observed"
                type="datetime-local"
                value={form.currentFirmwareObservedAt}
                onChange={(event) =>
                  setForm({
                    ...form,
                    currentFirmwareObservedAt: event.target.value,
                  })
                }
                disabled={!form.currentFirmwareReleaseId}
              />
            </FormField>

            <FormField
              label="Inventory source"
              htmlFor="device-edit-source"
              error={fieldErrors.source}
            >
              <SelectInput
                id="device-edit-source"
                value={form.source}
                onChange={(event) =>
                  setForm({ ...form, source: event.target.value })
                }
              >
                <option value="MANUAL">Manual</option>
                <option value="API">API</option>
                <option value="IMPORT">Import</option>
              </SelectInput>
            </FormField>

            <FormField
              label="External provider"
              htmlFor="device-edit-provider"
              error={fieldErrors.externalProvider}
            >
              <TextInput
                id="device-edit-provider"
                value={form.externalProvider}
                onChange={(event) =>
                  setForm({
                    ...form,
                    externalProvider: event.target.value,
                  })
                }
              />
            </FormField>

            <FormField
              label="External ID"
              htmlFor="device-edit-external-id"
              error={fieldErrors.externalId}
            >
              <TextInput
                id="device-edit-external-id"
                value={form.externalId}
                onChange={(event) =>
                  setForm({ ...form, externalId: event.target.value })
                }
              />
            </FormField>

            <div className="md:col-span-2">
              <FormField
                label="Notes"
                htmlFor="device-edit-notes"
                error={fieldErrors.notes}
              >
                <TextArea
                  id="device-edit-notes"
                  rows={4}
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                />
              </FormField>
            </div>

            <label className="flex items-center gap-3 text-sm font-semibold text-[var(--muted-strong)]">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.checked })
                }
              />
              Active inventory record
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button type="button" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save device'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
