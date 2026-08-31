# NOC Orchestrator contributor guidance

## Workflow

- Inspect `main` before starting work.
- Every GitHub issue gets its own branch created from the current `main` branch.
- Keep each branch scoped to its issue.
- Use meaningful commits and reference the issue in PRs.
- Do not commit directly to `main` for feature work.

## Product boundaries

NOC Orchestrator manages firmware lifecycle state: recorded current firmware, desired firmware policy, lifecycle decisions, planning, filtering, reporting, and later orchestration.

It is **not** a general-purpose network monitoring system. Do not add interface graphs, bandwidth graphs, SNMP polling, packet-loss monitoring, topology monitoring, syslog collection, flow analytics, or unrelated device-health dashboards unless a future requirement explicitly changes that boundary.

The MVP remains agentless and does not require live communication with network devices.

## Architecture

For v0.1.0 use the single Next.js application architecture. Do not add a separate FastAPI/backend service unless a later issue explicitly introduces a justified worker or orchestration service.

Keep implementation small and easy to edit. Prefer straightforward server-side modules and reusable UI components over framework-like internal abstractions.

## Authentication

Better Auth is the authentication foundation.

- Local email/password accounts are administrator-created; public local sign-up is disabled.
- Microsoft Entra ID is the intended SSO method.
- MFA is expected to be enforced by Entra Conditional Access, not reimplemented in NOC Orchestrator.
- Do not assume Microsoft login alone guarantees MFA.

## Development speed

Issues #1-#15 prioritize working functionality and targeted domain correctness. Avoid introducing heavy blocking validation pipelines during early MVP development. Issue #16 is the main release-hardening and broad-test pass.

## License

The project is licensed under AGPL-3.0. Preserve the existing license and use `SPDX-License-Identifier: AGPL-3.0-only` where file-level identifiers are useful.
