/**
 * Render an absolute timestamp identically during Next.js SSR and hydration.
 * Neither the browser's locale nor the server's timezone may influence output.
 */
export function formatAmsterdamTimestamp(value: string | Date | null | undefined) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('nl-NL', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map(({ type, value }) => [type, value]),
  )
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
}
