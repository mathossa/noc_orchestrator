# Development

## Requirements

- Node.js 24
- npm 11 or newer
- Docker with Docker Compose

## First-time setup

```bash
cp .env.example .env
npm install
npm run db:up
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

The web application is available at `http://localhost:3000`.

Health endpoint:

```text
GET http://localhost:3000/api/v1/health
```

## Database

PostgreSQL is the only service container required for normal local MVP development.

The NOC Orchestrator PostgreSQL container listens on port `5432` internally and is exposed as `localhost:5433` for local development. This avoids collisions with other local projects that may already use host port `5432`.

```bash
npm run db:up
npm run db:down
```

Prisma commands:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
```

The migration history is additive:

- `20260831130000_baseline`: authentication foundation from Issue #1
- `20260831135000_core_domain_model`: NOC Orchestrator MVP domain tables from Issue #2

The core relationships, ownership boundaries, provenance strategy, policy evolution path, and migration/rebuild rules are documented in [domain-model.md](domain-model.md).

### Clean local migration rebuild

To test all committed migrations from an empty **disposable local** database:

```bash
docker compose down -v
npm run db:up
npm run prisma:generate
npm run prisma:deploy
```

`docker compose down -v` permanently deletes the local PostgreSQL volume. Do not use this procedure on an environment whose data must be retained.

Applied migration files are immutable. Make future database changes through new forward migrations. Production rollback should use a backup/restore plan or a deliberate compensating forward migration rather than editing or deleting an applied migration.

## Background jobs

Background jobs use `pg-boss` against the same PostgreSQL database configured by `DATABASE_URL`. pg-boss manages its own `pgboss` schema; Prisma migrations remain authoritative only for NOC Orchestrator domain tables.

Run the normal application and worker in separate terminals:

```bash
npm run dev
npm run worker
```

The worker registers only known typed handlers and shuts down gracefully on `SIGINT`/`SIGTERM`. Structured JSON logs include the job name, queue job ID, correlation key, attempt, duration, and success/failure classification without logging full payloads.

The harmless demonstration job can prove durable enqueue/worker/output behavior:

```bash
npm run jobs:demo -- enqueue local-check
# Copy the returned jobId after the worker handles it:
npm run jobs:demo -- inspect <job-id>
```

A recurring demonstration schedule can be registered and removed without a custom cron table:

```bash
npm run jobs:demo -- schedule local-demo
npm run jobs:demo -- unschedule local-demo
```

The demonstration queue performs no firmware/device action. Queue presence or delivery is never firmware execution authorization; future execution remains behind the explicit approval and safety model from Issue #82.

### Background-job PostgreSQL tests

Unit tests run normally through `npm test`. The meaningful pg-boss integration tests require a disposable PostgreSQL database and intentionally opt in through `JOB_TEST_DATABASE_URL` until Issue #98's shared Testcontainers foundation is available.

For the existing local PostgreSQL container, create a disposable test database once:

```bash
docker exec noc-orchestrator-postgres \
  psql -U noc_orchestrator -d postgres \
  -c 'CREATE DATABASE noc_orchestrator_job_test;'
```

Then run:

```bash
JOB_TEST_DATABASE_URL='postgresql://noc_orchestrator:noc_orchestrator_dev@localhost:5433/noc_orchestrator_job_test' \
  npm run test:jobs
```

The tests use an isolated random pg-boss schema and cover enqueue/execution across restart, idempotent duplicate submission, retry, terminal failure, recurring scheduling, and graceful worker shutdown. They do not need Prisma domain fixtures because #99 intentionally does not mutate domain state.

## Authentication bootstrap

Public email/password registration is disabled. Local users are created administratively.

After the database has been migrated and Better Auth is configured, create the first administrator with:

```bash
npm run auth:create-admin -- --email admin@example.com --name "Administrator"
```

The command prompts for a password if one is not supplied.

Microsoft Entra ID is enabled only when all of these are configured:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`

For local Entra development, configure the app registration redirect URI as:

```text
http://localhost:3000/api/auth/callback/microsoft
```

MFA must be enforced by the organization's Entra Conditional Access/authentication policy.

## Production containers

Normal development intentionally runs Next.js natively and only PostgreSQL in Docker for the fastest feedback loop.

Production uses application and PostgreSQL containers from the same repository/codebase. The database is not published to a host port by `compose.production.yml`; it is only reachable on the internal Compose network.

Create a production environment file from the example and replace every placeholder/secret:

```bash
cp .env.production.example .env.production
```

`DATABASE_URL` must use the Compose service name `postgres` as its hostname, for example:

```text
postgresql://noc_orchestrator:<url-encoded-password>@postgres:5432/noc_orchestrator
```

Start the production stack with:

```bash
docker compose --env-file .env.production -f compose.production.yml up -d --build
```

The production image exposes these roles from the same codebase:

- `postgres`: persistent PostgreSQL database
- `migrate`: one-shot Prisma migration job that must succeed before application startup
- `app`: small Next.js standalone runtime container
- `worker` Docker target: the Node pg-boss worker process for deployments that enable background-job consumption

Check status with:

```bash
docker compose --env-file .env.production -f compose.production.yml ps
```

## Useful checks

These commands exist to catch breakage, but early MVP work intentionally avoids a large mandatory validation pipeline:

```bash
npm run prisma:generate
npx prisma validate
npm run typecheck
npm run lint
npm test
npm run test:jobs
npm run build
npm run worker:build
npm run format:check
```

Issue #16 expands and hardens the final release validation process.

### Importer v2 baseline

Issue #44 adds a production-data-free 12,000-row regression and CPU benchmark fixture:

```bash
npm test -- src/lib/importer-v2-regression-fixtures.test.ts
npm run benchmark:importer-v2
```

The benchmark phase definitions, limitations, and latest recorded results are documented in [importer-v2-regression-baseline.md](importer-v2-regression-baseline.md).

The immutable evaluation input/output model, decision precedence, quarantine boundary, and row status axes are documented in [importer-v2-evaluation.md](importer-v2-evaluation.md).
