# Architecture

## v0.1.0 architecture

NOC Orchestrator starts as one full-stack Next.js application backed by PostgreSQL.

```text
Browser
   |
   v
Next.js
|- React UI
|- Route Handlers / Server Actions
|- Better Auth
|- domain and query modules
`- Prisma
      |
      v
 PostgreSQL
```

This intentionally avoids a separate frontend/backend split during the MVP. The application is primarily forms, tables, filters, policy resolution, workflow state, and database aggregation. A second runtime would add deployment, authentication, API-contract, and development overhead without solving an MVP problem.

## Future service boundary

A separate worker or orchestration service may be introduced when the product needs long-running work such as firmware execution, scheduled synchronization, SSH/vendor SDK communication, controller jobs, retries, rollback, or distributed job processing.

That future boundary should be introduced because the workload requires it, not pre-created for architectural symmetry.

## Product ownership boundary

NOC Orchestrator owns:

- desired firmware policy
- firmware lifecycle decisions
- planning state
- ignore/customer-decline decisions
- audit/lifecycle history
- firmware-focused filtering and reporting

External source-of-truth, inventory, monitoring, and management systems may later provide recorded inventory/current-state data through replaceable integrations. Synchronization must not overwrite NOC Orchestrator-owned lifecycle data accidentally.

## Agentless boundary

v0.1.0 performs no live network-device discovery. Inventory/current firmware comes from manual entry initially and external synchronization later.

Future execution may use APIs, SSH, controllers, management platforms, or other vendor-supported mechanisms while remaining agentless.

## Non-NMS boundary

NOC Orchestrator is not intended to provide interface monitoring, CPU/memory graphs, bandwidth graphs, packet-loss monitoring, syslog collection, flow analytics, topology monitoring, or generic network-health dashboards.

## Authentication direction

Better Auth is used as the authentication foundation.

Authentication methods:

1. administrator-created local email/password accounts
2. Microsoft Entra ID SSO

Public local registration is disabled. The Better Auth admin plugin provides a bootstrap/admin-created-user path without exposing public sign-up.

Microsoft Entra authentication uses the built-in Microsoft provider and a concrete tenant ID. The organization's Entra Conditional Access policy is responsible for MFA. Enabling Microsoft login does not by itself guarantee MFA.

The architecture should later allow organizations to require SSO for normal users while retaining a controlled local break-glass administrator if desired.

## Dashboard direction

The dashboard should remain easy to edit. Use a fixed-grid widget model rather than a free-form canvas.

A later implementation can represent a default layout as simple data containing widget type, grid position, and allowed size. This enables organization defaults and later user overrides without forcing a complex dashboard framework into the MVP foundation.

## Development policy

During Issues #1-#15, prioritize working product behavior and targeted tests around important domain rules. Formatting, broad E2E coverage, edge-case expansion, and release hardening are concentrated in Issue #16.
