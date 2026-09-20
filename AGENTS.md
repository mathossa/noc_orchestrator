# NOC Orchestrator contributor guidance

## Workflow

- Inspect `main` before starting work.
- Every GitHub issue gets its own branch from current `main`.
- Keep each branch scoped to its issue.
- Use meaningful commits and reference the issue in PRs.
- Do not commit feature work directly to `main`.

## Product boundary

NOC Orchestrator manages network firmware lifecycle state: observed/current firmware, desired policy, compatibility/compliance, exceptions, planning, reporting, integrations, and later controlled execution.

It is **not** a general-purpose NMS. Do not add interface/bandwidth graphs, SNMP polling, packet-loss monitoring, topology monitoring, syslog/flow collection, or unrelated health dashboards unless an issue explicitly changes that boundary.

## Reuse-first / copy-first rule

Do not build generic infrastructure from scratch when a maintained, license-compatible open-source implementation already solves the problem well.

Before implementing a substantial capability, inspect in this order:
1. existing NOC Orchestrator code and merged contracts;
2. official vendor SDKs/protocol libraries;
3. maintained open-source libraries/projects with compatible licenses;
4. custom code only for the remaining NOC-specific behavior.

Prefer adapting/integrating proven code over recreating queues, SSH transports, parsers, graph algorithms, PDF/browser engines, test infrastructure, API clients, PKI, secret stores, or artifact stores.

Do **not** blindly copy source. Verify license, maintenance status, security posture, runtime fit, and whether reuse would simplify the product. Preserve required notices/attribution. Never copy code with incompatible licensing.

NOC Orchestrator should continue to own its domain logic: firmware policy/inheritance, compatibility/compliance interpretation, exception semantics, work planning, review/report meaning, and execution safety decisions. Do not replace these with a generic framework merely to reduce local code.

If an issue names a preferred OSS project, evaluate/reuse it first. If you reject it, document the concrete reason in the PR before implementing a replacement.

Every substantial PR should briefly state:
- what existing/OSS code was reused;
- what custom code remains and why;
- any new dependency/license introduced.

See `docs/vision.md` and `docs/architecture.md` for the product and reuse boundaries.

## Architecture

For v0.1.0 keep the single Next.js application backed by PostgreSQL. Do not add another backend service unless an issue requires a worker/agent or a workload clearly justifies it.

Keep implementation small and editable. Prefer direct server-side modules and reusable UI components over internal framework-building.

## Authentication

Better Auth is the authentication foundation. Local accounts are administrator-created; public sign-up is disabled. Microsoft Entra ID is the intended SSO method. MFA is expected through Entra Conditional Access, not reimplemented locally.

## Development speed

Prioritize working behavior and targeted domain correctness. Avoid unnecessary infrastructure or abstraction work unless it removes more custom code than it adds. Release-hardening belongs in the dedicated release/test work.

## License

The project is AGPL-3.0. Preserve the existing license and use `SPDX-License-Identifier: AGPL-3.0-only` where useful.