# Architecture

## Current architecture

NOC Orchestrator is one full-stack Next.js application backed by PostgreSQL. Long-running background work uses a worker from the same Node/TypeScript codebase and the same PostgreSQL service.

```text
Browser
  ↓
Next.js
  ├─ React UI
  ├─ Route Handlers / Server Actions
  ├─ Better Auth
  ├─ domain/query modules
  └─ Prisma ────────────────┐
                            │
Node background worker      │
  └─ typed handlers         │
       ↓                    │
     pg-boss                │
       └────────────────────┤
                            ↓
                       PostgreSQL
```

Prisma remains authoritative for NOC Orchestrator domain state. pg-boss owns only its internal queue/schedule schema and job lifecycle; its tables are deliberately not modeled in Prisma.

This remains the default architecture while the product is primarily inventory, policy resolution, compliance, exceptions, planning, reporting, and database aggregation. Do not split frontend/backend merely for architectural symmetry.

## Ownership boundary

NOC Orchestrator owns the firmware-specific meaning and workflow:
- desired firmware policy and inheritance;
- compatibility/compliance/recommendation resolution;
- exceptions and customer decisions;
- work planning and historical snapshots;
- firmware review/report semantics;
- execution approvals and safety decisions.

External systems may supply observed inventory/current-state evidence. They must not silently overwrite NOC-owned policy or decisions.

## Reuse-first architecture

Generic infrastructure should normally come from maintained open source or official vendor SDKs rather than custom implementations.

Preferred direction by capability:

| Capability | Preferred foundation |
|---|---|
| Browser/E2E and PDF rendering | Playwright |
| Real PostgreSQL integration tests | Testcontainers |
| Durable PostgreSQL background jobs | pg-boss |
| Large tabular/virtualized UI where needed | TanStack Table/Virtual |
| Upgrade/dependency graph algorithms | Graphlib or equivalent maintained graph library |
| Vendor API clients | official SDK first, generated OpenAPI client second |
| Network SSH transport | Scrapli or another maintained network-focused SSH library |
| CLI output parsing | NTC Templates/TextFSM where suitable |
| Agent machine identity/PKI | step-ca or equivalent PKI service |
| Secret backend | provider abstraction; OpenBao is a preferred deployable backend |
| Firmware artifact transport/cache | evaluate OCI/ORAS before custom binary storage |

These are preferred starting points, not unconditional dependencies. An issue may choose another maintained project when runtime, licensing, security, or functionality makes it a better fit. The PR must record why.

Do not replace NOC-specific policy/planning logic with Nautobot, NetBox, OPA, or a generic rules engine merely because they overlap conceptually. They are references/integration targets unless an issue proves a narrower reusable component is beneficial.

## Background-job foundation

Issue #99 uses `pg-boss` 12.32.0 as a normal npm dependency rather than copying queue code. pg-boss is MIT licensed, supports the repository's Node.js 24 runtime, and requires PostgreSQL 13 or newer. The project already runs PostgreSQL 17, so no Redis, RabbitMQ, Kafka, Temporal, second database service, or custom cron/queue tables are introduced.

Application code registers a deliberately small set of known job names and versioned payloads. Payloads should contain identifiers or snapshot references such as `reviewCycleId`, not large domain snapshots. Future quarterly-review/reporting and Inventory Sync features may add their own typed handlers while keeping their authoritative records in Prisma-managed domain tables.

There are three separate identifiers to keep distinct:
- **queue job ID**: pg-boss-generated identity for one queued attemptable work item;
- **domain/business ID**: the NOC Orchestrator object being processed, stored in normal domain tables;
- **correlation/idempotency key**: application-supplied `singletonKey` used to suppress accidental duplicate queued/active work for the same logical operation.

Retries, backoff, expiry, retention, scheduling, cancellation, and queue uniqueness use pg-boss primitives directly. Cancellation is queue-state control, not a guarantee that arbitrary side effects already performed by an active handler can be undone.

## Worker and firmware-execution boundary

The background worker is generic infrastructure for safe non-request work such as future report generation or Inventory Sync orchestration. A pg-boss job is never authorization to change firmware or otherwise perform disruptive device work.

Controlled firmware execution remains the separate post-0.1 boundary owned by Issue #82. An execution flow must still have its explicit NOC-owned execution job, approvals, maintenance-window validation, pre-checks, safety gates, state machine, and audit trail. Queue existence, queue state, successful delivery, or a schedule firing cannot substitute for any of those authorization checks.

Conceptually:

```text
pg-boss delivery / trigger
        ↓
NOC-owned application service
        ↓
explicit execution authorization/state (#82)
        ↓ HTTPS/jobs
NOC Agent or vendor API executor
        ↓
device / controller / cloud API
```

Customer-network agents should initiate outbound communication. The central web application should not require inbound SSH access to customer devices. Agent/API executors share the same NOC-owned execution-job and audit model while reusing vendor/network libraries underneath.

## Product boundaries

NOC Orchestrator is not a general NMS. It does not own interface monitoring, bandwidth/flow analytics, generic syslog collection, topology monitoring, or unrelated device-health dashboards.

Better Auth remains the authentication foundation; Microsoft Entra ID is the intended SSO method and Entra Conditional Access provides MFA policy.