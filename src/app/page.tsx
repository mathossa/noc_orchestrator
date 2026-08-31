export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <section className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-2xl shadow-black/20">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          v0.1.0 foundation
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">NOC Orchestrator</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)]">
          Firmware lifecycle management built around recorded current state, desired state,
          planning, and explicit operational decisions.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="text-sm text-[var(--muted)]">Application</div>
            <div className="mt-1 font-medium">Next.js + TypeScript</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="text-sm text-[var(--muted)]">Data</div>
            <div className="mt-1 font-medium">PostgreSQL + Prisma</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="text-sm text-[var(--muted)]">Authentication</div>
            <div className="mt-1 font-medium">Better Auth prepared</div>
          </div>
        </div>
      </section>
    </main>
  )
}
