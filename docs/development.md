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

The committed baseline migration contains only the authentication foundation. Issue #2 introduces the NOC Orchestrator domain schema.

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

## Useful checks

These commands exist to catch breakage, but early MVP work intentionally avoids a large mandatory validation pipeline:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

Issue #16 expands and hardens the final release validation process.
