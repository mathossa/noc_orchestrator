# Architecture

## Current architecture

NOC Orchestrator is one full-stack Next.js application backed by PostgreSQL.

```text
Browser
  ↓
Next.js
  ├─ React UI
  ├─ Route Handlers / Server Actions
  ├─ Better Auth
  ├─ domain/query modules
  └─ Prisma
       ↓
   PostgreSQL
```

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

## Future worker and execution boundary

Long-running synchronization/report jobs may use a PostgreSQL-backed job worker without introducing a second message broker unnecessarily.

Controlled firmware execution is a separate post-0.1 boundary:

```text
NOC Orchestrator control plane
        ↓ HTTPS/jobs
NOC Agent or vendor API executor
        ↓
device / controller / cloud API
```

Customer-network agents should initiate outbound communication. The central web application should not require inbound SSH access to customer devices. Agent/API executors share the same NOC-owned execution-job and audit model while reusing vendor/network libraries underneath.

## Product boundaries

NOC Orchestrator is not a general NMS. It does not own interface monitoring, bandwidth/flow analytics, generic syslog collection, topology monitoring, or unrelated device-health dashboards.

Better Auth remains the authentication foundation; Microsoft Entra ID is the intended SSO method and Entra Conditional Access provides MFA policy.