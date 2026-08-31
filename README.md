# NOC Orchestrator

NOC Orchestrator is an **agentless network firmware lifecycle and orchestration platform**.

Its core purpose is to make the relationship between **recorded current firmware** and **desired firmware** understandable and actionable across customers, device models, vendors, device types, contract types, and individual devices.

```text
CURRENT STATE -> DESIRED STATE
```

NOC Orchestrator is not a general-purpose network monitoring platform. It is focused on firmware state, policy, planning, lifecycle decisions, reporting, and later controlled firmware orchestration.

## v0.1.0 architecture

The MVP intentionally uses a small single-application stack:

- Next.js 16
- React 19
- TypeScript
- Node.js 24 + npm
- PostgreSQL 17
- Prisma
- Better Auth
- Tailwind CSS

PostgreSQL runs through Docker Compose for local development; Next.js runs natively for fast reload and debugging.

See [docs/architecture.md](docs/architecture.md) for the architectural boundaries, [docs/domain-model.md](docs/domain-model.md) for the core firmware data model, and [docs/development.md](docs/development.md) for local setup.

## Quick start

```bash
cp .env.example .env
npm install
npm run db:up
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Then open `http://localhost:3000`.

Health check: `GET /api/v1/health`

## Authentication direction

Better Auth is prepared for:

- administrator-created local email/password accounts
- Microsoft Entra ID SSO

Public local registration is disabled. MFA is expected to be enforced by Microsoft Entra Conditional Access when SSO is used; NOC Orchestrator does not implement a separate MFA system for that flow.

## MVP scope

v0.1.0 focuses on manual inventory, current firmware, desired firmware policy, firmware-state comparison, lifecycle decisions, filtering, drill-down views, and a firmware-focused dashboard.

External synchronization and actual firmware execution are post-MVP concerns.

## License

GNU Affero General Public License v3.0 (`AGPL-3.0`). See [LICENSE](LICENSE).
