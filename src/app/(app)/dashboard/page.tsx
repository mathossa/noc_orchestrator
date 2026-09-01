import Link from 'next/link'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { TechnicalStatusBadge, WorkflowStatusBadge } from '@/components/ui/status-badge'
import { deviceFilterHref, technicalStateDeviceHref, workflowDeviceHref } from '@/lib/drilldown-links'
import { getFirmwareLifecycleDashboard } from '@/lib/dashboard-store'
import type { DashboardWorkflowState } from '@/lib/dashboard'

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

function workflowLabel(state: DashboardWorkflowState) {
  switch (state) {
    case 'PLANNED': return 'Planned'
    case 'IGNORED': return 'Ignored'
    case 'CUSTOMER_DECLINED': return 'Customer declined'
    case 'DONE': return 'Done'
  }
}

export default async function DashboardPage() {
  const dashboard = await getFirmwareLifecycleDashboard()
  const hasInventory = dashboard.inventory.devices > 0

  return (
    <>
      <PageHeader
        eyebrow="Firmware lifecycle"
        title="Dashboard"
        description="Recorded inventory, desired-state compliance, and lifecycle decisions. Technical firmware state and operational workflow remain intentionally separate."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Device inventory</Link>
            <Link href={technicalStateDeviceHref({}, 'ACTION_REQUIRED')} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Firmware attention</Link>
          </div>
        }
      />

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Inventory footprint</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Active configured objects and active recorded devices.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatLink href="/customers"><SummaryStat label="Customers" value={dashboard.inventory.customers} detail="Active customer records." /></StatLink>
          <StatLink href="/devices"><SummaryStat label="Devices" value={dashboard.inventory.devices} detail="Active recorded inventory devices." /></StatLink>
          <StatLink href="/models"><SummaryStat label="Models" value={dashboard.inventory.models} detail="Active concrete device models." /></StatLink>
          <StatLink href="/vendors"><SummaryStat label="Vendors" value={dashboard.inventory.vendors} detail="Active configured vendors." /></StatLink>
        </div>
      </section>

      {!hasInventory ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            title="No active device inventory yet"
            description="Start with a vendor/model and a manual device, or populate inventory later through an API/import integration. The dashboard will derive firmware state as soon as recorded devices exist."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/models" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Configure models</Link>
                <Link href="/devices" className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Add a device</Link>
              </div>
            }
          />
        </section>
      ) : (
        <>
          <section className="mt-7">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Technical firmware state</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">Exact recorded current release versus exact desired model release. These counts do not describe planning status.</p>
              </div>
              <Link href="/devices" className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Open filtered inventory</Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatLink href={technicalStateDeviceHref({}, 'CURRENT')}><SummaryStat label="Desired-state compliant" value={dashboard.technical.current} detail="Current release exactly matches desired." accessory={<TechnicalStatusBadge state="CURRENT" />} /></StatLink>
              <StatLink href={technicalStateDeviceHref({}, 'ACTION_REQUIRED')}><SummaryStat label="Needs firmware action" value={dashboard.technical.actionRequired} detail="Recorded current release differs from desired." accessory={<TechnicalStatusBadge state="ACTION_REQUIRED" />} /></StatLink>
              <StatLink href={technicalStateDeviceHref({}, 'UNKNOWN')}><SummaryStat label="Unknown firmware" value={dashboard.technical.unknown} detail="A desired release exists, but current is unknown." accessory={<TechnicalStatusBadge state="UNKNOWN" />} /></StatLink>
              <StatLink href={technicalStateDeviceHref({}, 'NO_POLICY')}><SummaryStat label="No desired policy" value={dashboard.technical.noPolicy} detail="No active model desired-firmware policy." accessory={<TechnicalStatusBadge state="NO_POLICY" />} /></StatLink>
            </div>
          </section>

          <section className="mt-7">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Lifecycle workflow decisions</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Operational choices about work. A Planned, Ignored, Declined, or Done device can still have any technical firmware state.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatLink href={workflowDeviceHref({}, 'PLANNED')}><SummaryStat label="Planned" value={dashboard.workflow.planned} detail="Upgrade work has been planned." accessory={<WorkflowStatusBadge state="PLANNED" />} /></StatLink>
              <StatLink href={workflowDeviceHref({}, 'IGNORED')}><SummaryStat label="Ignored" value={dashboard.workflow.ignored} detail="Internally accepted/ignored for now." accessory={<WorkflowStatusBadge state="IGNORED" />} /></StatLink>
              <StatLink href={workflowDeviceHref({}, 'CUSTOMER_DECLINED')}><SummaryStat label="Customer declined" value={dashboard.workflow.customerDeclined} detail="Customer explicitly declined the change." accessory={<WorkflowStatusBadge state="CUSTOMER_DECLINED" />} /></StatLink>
              <StatLink href={workflowDeviceHref({}, 'DONE')}><SummaryStat label="Done" value={dashboard.workflow.done} detail="Lifecycle work was marked completed." accessory={<WorkflowStatusBadge state="DONE" />} /></StatLink>
              <StatLink href={workflowDeviceHref({}, 'UNDECIDED')}><SummaryStat label="No decision" value={dashboard.workflow.undecided} detail="No lifecycle workflow decision recorded." accessory={<span className="rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Undecided</span>} /></StatLink>
            </div>
          </section>

          <div className="mt-7 grid gap-5 xl:grid-cols-2">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Models requiring the most updates" description="Concrete models ranked by devices whose recorded current release differs from desired." action={<Link href={technicalStateDeviceHref({}, 'ACTION_REQUIRED')} className="text-xs font-semibold text-[var(--accent-light)] hover:underline">All action required</Link>} />
              {dashboard.modelsRequiringUpdates.length === 0 ? (
                <div className="px-4 py-7 text-sm text-[var(--muted)]">No active devices currently differ from their desired release.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Model</th><th className="px-4 py-3">Devices</th><th className="px-4 py-3">Action required</th><th className="px-4 py-3">Other unresolved</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dashboard.modelsRequiringUpdates.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3"><Link href={`/models/${row.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{row.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{row.context}</div></td>
                          <td className="px-4 py-3 tabular-nums">{row.devices}</td>
                          <td className="px-4 py-3"><Link href={technicalStateDeviceHref({ model: row.id }, 'ACTION_REQUIRED')} className="font-semibold tabular-nums text-[var(--accent-light)] hover:underline">{row.actionRequired}</Link></td>
                          <td className="px-4 py-3 text-xs text-[var(--muted-strong)]">{row.unknown} unknown · {row.noPolicy} no policy</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Customers requiring the most updates" description="Customers ranked by active devices with a technical Action required state." />
              {dashboard.customersRequiringUpdates.length === 0 ? (
                <div className="px-4 py-7 text-sm text-[var(--muted)]">No customer currently has active devices requiring a firmware change.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Devices</th><th className="px-4 py-3">Action required</th><th className="px-4 py-3">Other unresolved</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dashboard.customersRequiringUpdates.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3"><Link href={`/customers/${row.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{row.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{row.context}</div></td>
                          <td className="px-4 py-3 tabular-nums">{row.devices}</td>
                          <td className="px-4 py-3"><Link href={technicalStateDeviceHref({ customer: row.id }, 'ACTION_REQUIRED')} className="font-semibold tabular-nums text-[var(--accent-light)] hover:underline">{row.actionRequired}</Link></td>
                          <td className="px-4 py-3 text-xs text-[var(--muted-strong)]">{row.unknown} unknown · {row.noPolicy} no policy</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,0.75fr)]">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Desired-state compliance by vendor" description="The same exact current-versus-desired resolver, grouped by vendor for active devices." />
              {dashboard.complianceByVendor.length === 0 ? (
                <div className="px-4 py-7 text-sm text-[var(--muted)]">No vendor compliance data is available yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Devices</th><th className="px-4 py-3">Current</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Unknown</th><th className="px-4 py-3">No policy</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dashboard.complianceByVendor.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3"><Link href={`/vendors/${row.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{row.name}</Link></td>
                          <td className="px-4 py-3 tabular-nums"><Link href={deviceFilterHref({ vendor: row.id })} className="hover:text-[var(--accent-light)] hover:underline">{row.devices}</Link></td>
                          <td className="px-4 py-3 tabular-nums"><Link href={technicalStateDeviceHref({ vendor: row.id }, 'CURRENT')} className="hover:text-[var(--accent-light)] hover:underline">{row.current}</Link></td>
                          <td className="px-4 py-3 tabular-nums"><Link href={technicalStateDeviceHref({ vendor: row.id }, 'ACTION_REQUIRED')} className="font-semibold text-[var(--accent-light)] hover:underline">{row.actionRequired}</Link></td>
                          <td className="px-4 py-3 tabular-nums"><Link href={technicalStateDeviceHref({ vendor: row.id }, 'UNKNOWN')} className="hover:text-[var(--accent-light)] hover:underline">{row.unknown}</Link></td>
                          <td className="px-4 py-3 tabular-nums"><Link href={technicalStateDeviceHref({ vendor: row.id }, 'NO_POLICY')} className="hover:text-[var(--accent-light)] hover:underline">{row.noPolicy}</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <SectionHeader title="Current firmware distribution" description="Most-used exact recorded releases on active devices. Version strings are display values only, not ordered precedence." />
              {dashboard.currentFirmwareDistribution.length === 0 ? (
                <div className="px-4 py-7 text-sm text-[var(--muted)]">No current firmware has been recorded yet.</div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {dashboard.currentFirmwareDistribution.map((release) => (
                    <div key={release.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/firmware/${release.id}`} className="font-mono text-sm font-semibold text-[var(--accent-light)] hover:underline">{release.version}</Link>
                        <div className="mt-1 truncate text-xs text-[var(--muted)]">{release.vendor} · {release.platform}</div>
                      </div>
                      <Link href={deviceFilterHref({ currentFirmware: release.id })} className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent-light)] hover:underline">{release.devices}</Link>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeader title="Recent firmware lifecycle decisions" description="Recent Planned, Ignored, Customer declined, and Done audit events. This is decision history, not monitoring alerts." action={<Link href="/planning" className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Planning workspace</Link>} />
            {dashboard.recentDecisions.length === 0 ? (
              <div className="px-4 py-7 text-sm text-[var(--muted)]">No lifecycle decisions have been recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Device</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Decision</th><th className="px-4 py-3">Reason / notes</th><th className="px-4 py-3">Actor</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {dashboard.recentDecisions.map((decision) => (
                      <tr key={decision.id}>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-[var(--muted-strong)]">{new Date(decision.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3"><Link href={`/devices/${decision.deviceId}`} className="font-semibold text-[var(--accent-light)] hover:underline">{decision.deviceName}</Link></td>
                        <td className="px-4 py-3">{decision.customerId ? <Link href={`/customers/${decision.customerId}`} className="hover:text-[var(--accent-light)] hover:underline">{decision.customerName ?? 'Customer'}</Link> : <span className="text-[var(--muted)]">—</span>}</td>
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><WorkflowStatusBadge state={decision.state} /><span className="text-xs text-[var(--muted)]">{workflowLabel(decision.state)}</span></div></td>
                        <td className="max-w-md px-4 py-3 text-xs leading-5 text-[var(--muted-strong)]">{decision.reason ?? decision.notes ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-[var(--muted-strong)]">{decision.actorName ?? 'System / unknown'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
