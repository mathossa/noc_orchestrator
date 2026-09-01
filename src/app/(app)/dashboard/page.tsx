import Link from 'next/link'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { TechnicalStatusBadge, WorkflowStatusBadge } from '@/components/ui/status-badge'
import { deviceFilterHref, technicalStateDeviceHref, workflowDeviceHref } from '@/lib/drilldown-links'
import { getFirmwareLifecycleDashboard } from '@/lib/dashboard-store'

export const dynamic = 'force-dynamic'

function StatLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-lg outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&>section]:h-full [&>section]:transition-colors hover:[&>section]:border-[var(--accent-muted)]"
    >
      {children}
    </Link>
  )
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
      </div>
      {action}
    </div>
  )
}

function contractFilter(id: string | null) {
  return id ?? 'none'
}

export default async function DashboardPage() {
  const dashboard = await getFirmwareLifecycleDashboard()

  return (
    <>
      <PageHeader
        eyebrow="Firmware lifecycle"
        title="Dashboard"
        description="Customer and site firmware attention first. Technical state and operational workflow remain separate."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Device inventory</Link>
            <Link href={technicalStateDeviceHref({}, 'ACTION_REQUIRED')} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Firmware attention</Link>
          </div>
        }
      />

      {dashboard.activeDevices === 0 ? (
        <EmptyState
          title="No active device inventory yet"
          description="Add a device or populate inventory through an API/import integration. Firmware attention will appear here as soon as recorded devices exist."
          action={<Link href="/devices" className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)]">Add a device</Link>}
        />
      ) : (
        <>
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold">What needs attention</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">The two technical signals that most directly affect day-to-day firmware work.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <StatLink href={technicalStateDeviceHref({}, 'ACTION_REQUIRED')}>
                <SummaryStat label="Needs firmware action" value={dashboard.technical.actionRequired} detail="Recorded current release differs from the exact desired release." accessory={<TechnicalStatusBadge state="ACTION_REQUIRED" />} />
              </StatLink>
              <StatLink href={technicalStateDeviceHref({}, 'UNKNOWN')}>
                <SummaryStat label="Unknown current firmware" value={dashboard.technical.unknown} detail="A desired release exists, but current firmware is not recorded." accessory={<TechnicalStatusBadge state="UNKNOWN" />} />
              </StatLink>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Other technical state</span>
              <Link href={technicalStateDeviceHref({}, 'CURRENT')} className="font-medium hover:text-[var(--accent-light)] hover:underline">Compliant <span className="ml-1 tabular-nums">{dashboard.technical.current}</span></Link>
              <Link href={technicalStateDeviceHref({}, 'NO_POLICY')} className="font-medium hover:text-[var(--accent-light)] hover:underline">No desired policy <span className="ml-1 tabular-nums">{dashboard.technical.noPolicy}</span></Link>
            </div>
          </section>

          <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeader title="Workflow" description="Compact operational status; these decisions do not change technical compliance." action={<Link href="/planning" className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Planning workspace</Link>} />
            <div className="flex flex-wrap gap-2 px-4 py-3">
              <Link href={workflowDeviceHref({}, 'PLANNED')} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"><WorkflowStatusBadge state="PLANNED" /><span className="tabular-nums">{dashboard.workflow.planned}</span></Link>
              <Link href={workflowDeviceHref({}, 'IGNORED')} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"><WorkflowStatusBadge state="IGNORED" /><span className="tabular-nums">{dashboard.workflow.ignored}</span></Link>
              <Link href={workflowDeviceHref({}, 'CUSTOMER_DECLINED')} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"><WorkflowStatusBadge state="CUSTOMER_DECLINED" /><span className="tabular-nums">{dashboard.workflow.customerDeclined}</span></Link>
              <Link href={workflowDeviceHref({}, 'DONE')} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"><WorkflowStatusBadge state="DONE" /><span className="tabular-nums">{dashboard.workflow.done}</span></Link>
              <Link href={workflowDeviceHref({}, 'UNDECIDED')} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">No decision</span><span className="tabular-nums">{dashboard.workflow.undecided}</span></Link>
            </div>
          </section>

          <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeader title="Customer and site attention" description="Primary work view: customers first, with the affected sites directly underneath." action={<Link href={technicalStateDeviceHref({}, 'ACTION_REQUIRED')} className="text-xs font-semibold text-[var(--accent-light)] hover:underline">All firmware action</Link>} />
            {dashboard.customerAttention.length === 0 ? (
              <div className="px-4 py-7 text-sm text-[var(--muted)]">No customer currently has Action required, Unknown current, or No policy devices.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Customer / site</th><th className="px-4 py-3">Action required</th><th className="px-4 py-3">Unknown</th><th className="px-4 py-3">No policy</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {dashboard.customerAttention.flatMap((customer) => [
                      <tr key={`customer-${customer.id}`} className="bg-[var(--surface-raised)]/50">
                        <td className="px-4 py-3"><Link href={deviceFilterHref({ customer: customer.id })} className="font-semibold text-[var(--accent-light)] hover:underline">{customer.name}</Link></td>
                        <td className="px-4 py-3"><Link href={technicalStateDeviceHref({ customer: customer.id }, 'ACTION_REQUIRED')} className="font-semibold tabular-nums hover:text-[var(--accent-light)] hover:underline">{customer.actionRequired}</Link></td>
                        <td className="px-4 py-3"><Link href={technicalStateDeviceHref({ customer: customer.id }, 'UNKNOWN')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{customer.unknown}</Link></td>
                        <td className="px-4 py-3"><Link href={technicalStateDeviceHref({ customer: customer.id }, 'NO_POLICY')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{customer.noPolicy}</Link></td>
                      </tr>,
                      ...customer.sites.map((site) => {
                        const scope = { customer: customer.id, site: site.id ?? 'none' }
                        return (
                          <tr key={`site-${customer.id}-${site.id ?? 'none'}`}>
                            <td className="px-4 py-2.5 pl-8"><Link href={deviceFilterHref(scope)} className="text-[var(--muted-strong)] hover:text-[var(--accent-light)] hover:underline">↳ {site.name}</Link></td>
                            <td className="px-4 py-2.5"><Link href={technicalStateDeviceHref(scope, 'ACTION_REQUIRED')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{site.actionRequired}</Link></td>
                            <td className="px-4 py-2.5"><Link href={technicalStateDeviceHref(scope, 'UNKNOWN')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{site.unknown}</Link></td>
                            <td className="px-4 py-2.5"><Link href={technicalStateDeviceHref(scope, 'NO_POLICY')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{site.noPolicy}</Link></td>
                          </tr>
                        )
                      }),
                    ])}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Attention by contract type" description="Effective contract (site override before customer default) as the main prioritization lens." />
              {dashboard.contractAttention.length === 0 ? (
                <div className="px-4 py-7 text-sm text-[var(--muted)]">No contract grouping currently has unresolved firmware attention.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Contract</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Unknown</th><th className="px-4 py-3">No policy</th><th className="px-4 py-3">Blocked</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dashboard.contractAttention.map((row) => {
                        const scope = { contract: contractFilter(row.id) }
                        return <tr key={row.id ?? 'none'}><td className="px-4 py-3"><Link href={deviceFilterHref(scope)} className="font-semibold text-[var(--accent-light)] hover:underline">{row.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{row.devices} active device{row.devices === 1 ? '' : 's'}</div></td><td className="px-4 py-3"><Link href={technicalStateDeviceHref(scope, 'ACTION_REQUIRED')} className="font-semibold tabular-nums hover:text-[var(--accent-light)] hover:underline">{row.actionRequired}</Link></td><td className="px-4 py-3"><Link href={technicalStateDeviceHref(scope, 'UNKNOWN')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{row.unknown}</Link></td><td className="px-4 py-3"><Link href={technicalStateDeviceHref(scope, 'NO_POLICY')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{row.noPolicy}</Link></td><td className="px-4 py-3 tabular-nums">{row.blocked}</td></tr>
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Attention by vendor" description="Secondary work-method lens for vendors that require a different upgrade approach." />
              {dashboard.vendorAttention.length === 0 ? (
                <div className="px-4 py-7 text-sm text-[var(--muted)]">No vendor currently has unresolved firmware attention.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Unknown</th><th className="px-4 py-3">No policy</th><th className="px-4 py-3">Blocked</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dashboard.vendorAttention.map((row) => {
                        const scope = { vendor: row.id ?? '' }
                        return <tr key={row.id ?? row.name}><td className="px-4 py-3"><Link href={row.id ? `/vendors/${row.id}` : deviceFilterHref(scope)} className="font-semibold text-[var(--accent-light)] hover:underline">{row.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{row.devices} active device{row.devices === 1 ? '' : 's'}</div></td><td className="px-4 py-3"><Link href={technicalStateDeviceHref(scope, 'ACTION_REQUIRED')} className="font-semibold tabular-nums hover:text-[var(--accent-light)] hover:underline">{row.actionRequired}</Link></td><td className="px-4 py-3"><Link href={technicalStateDeviceHref(scope, 'UNKNOWN')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{row.unknown}</Link></td><td className="px-4 py-3"><Link href={technicalStateDeviceHref(scope, 'NO_POLICY')} className="tabular-nums hover:text-[var(--accent-light)] hover:underline">{row.noPolicy}</Link></td><td className="px-4 py-3 tabular-nums">{row.blocked}</td></tr>
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {dashboard.firmwareAttention.length > 0 ? (
            <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Firmware releases needing attention" description="Only releases used by Action required devices, plus BLOCKED releases. General firmware distribution lives in the Firmware catalog." action={<Link href="/firmware" className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Firmware catalog</Link>} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Release</th><th className="px-4 py-3">Vendor / platform</th><th className="px-4 py-3">Affected devices</th><th className="px-4 py-3">Action required</th><th className="px-4 py-3">Blocked</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {dashboard.firmwareAttention.map((release) => (
                      <tr key={release.id}>
                        <td className="px-4 py-3"><Link href={`/firmware/${release.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{release.version}</Link><div className="mt-1 text-xs text-[var(--muted)]">{release.status}</div></td>
                        <td className="px-4 py-3">{release.vendor}<div className="mt-1 text-xs text-[var(--muted)]">{release.platform}</div></td>
                        <td className="px-4 py-3 tabular-nums"><Link href={deviceFilterHref({ currentFirmware: release.id })} className="hover:text-[var(--accent-light)] hover:underline">{release.devices}</Link></td>
                        <td className="px-4 py-3 tabular-nums"><Link href={technicalStateDeviceHref({ currentFirmware: release.id }, 'ACTION_REQUIRED')} className="font-semibold hover:text-[var(--accent-light)] hover:underline">{release.actionRequired}</Link></td>
                        <td className="px-4 py-3 tabular-nums">{release.blocked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
