type DeviceFilterValue = string | number | null | undefined

export function deviceFilterHref(filters: Record<string, DeviceFilterValue>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `/devices?${query}` : '/devices'
}

export function technicalStateDeviceHref(scope: Record<string, DeviceFilterValue>, state: string) {
  return deviceFilterHref({ ...scope, technicalState: state })
}

export function workflowDeviceHref(scope: Record<string, DeviceFilterValue>, state: string) {
  return deviceFilterHref({ ...scope, workflow: state })
}
