import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/ui/filter-bar'
import { EmptyState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { TechnicalStatusBadge, WorkflowStatusBadge } from '@/components/ui/status-badge'

type PreviewRow = {
  id: string
  device: string
  customer: string
  current: string
  desired: string
}

const columns: Array<DataTableColumn<PreviewRow>> = [
  { key: 'device', header: 'Device', render: (row) => row.device },
  { key: 'customer', header: 'Customer', render: (row) => row.customer },
  { key: 'current', header: 'Current firmware', render: (row) => row.current },
  { key: 'desired', header: 'Desired firmware', render: (row) => row.desired },
]

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Firmware lifecycle"
        title="Dashboard"
        description="The shared NOC workspace is ready. Live firmware aggregation and operational dashboard data are implemented in later MVP issues."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Devices" value="—" detail="Live inventory connects in the device workflow." />
        <SummaryStat label="Action required" value="—" detail="Derived firmware state arrives with state resolution." />
        <SummaryStat label="Planned" value="—" detail="Lifecycle counts connect to planning records." />
        <SummaryStat label="No policy" value="—" detail="Policy coverage is calculated from desired firmware rules." />
      </div>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Status language</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Technical firmware state and lifecycle workflow use intentionally different badge shapes and semantics.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Technical firmware state</p>
            <div className="flex flex-wrap gap-2">
              <TechnicalStatusBadge state="CURRENT" />
              <TechnicalStatusBadge state="ACTION_REQUIRED" />
              <TechnicalStatusBadge state="UNKNOWN" />
              <TechnicalStatusBadge state="NO_POLICY" />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Lifecycle workflow</p>
            <div className="flex flex-wrap gap-2">
              <WorkflowStatusBadge state="PLANNED" />
              <WorkflowStatusBadge state="IGNORED" />
              <WorkflowStatusBadge state="CUSTOMER_DECLINED" />
              <WorkflowStatusBadge state="DONE" />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Engineering table foundation</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Dense filters and tables are in place; no sample inventory is presented as live data.</p>
        </div>
        <FilterBar actions={<Button variant="ghost">Clear filters</Button>}>
          <FilterSearch placeholder="Device, customer, model…" />
          <FilterSelect
            id="technical-state"
            label="Technical state"
            defaultValue="all"
            options={[
              { value: 'all', label: 'All states' },
              { value: 'current', label: 'Current' },
              { value: 'action', label: 'Action required' },
              { value: 'unknown', label: 'Unknown' },
              { value: 'no-policy', label: 'No policy' },
            ]}
          />
          <FilterSelect
            id="workflow-state"
            label="Workflow"
            defaultValue="all"
            options={[
              { value: 'all', label: 'All workflow states' },
              { value: 'planned', label: 'Planned' },
              { value: 'ignored', label: 'Ignored' },
              { value: 'declined', label: 'Customer declined' },
              { value: 'done', label: 'Done' },
            ]}
          />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          caption="Firmware attention preview"
          emptyState={
            <EmptyState
              title="No live inventory connected yet"
              description="This table intentionally remains empty in the shared UI issue. Device records and firmware state will populate it in later MVP work."
            />
          }
        />
      </section>
    </>
  )
}
