# ADR 0002: Auvik API is an InventorySource adapter into Importer v2

Status: accepted for Issue #114 implementation.

## Context

Issue #80 established that external inventory transports normalize into the
shared Importer v2 reconciliation and publication pipeline. Auvik is the first
live API adapter built on that boundary.

Auvik Device API v2 uses region-specific API hosts, HTTP Basic authentication,
single-tenant device queries and JSON:API responses. Tenant discovery remains a
v1 endpoint. The provider can return HTTP 308 when an account belongs to a
different region.

## Decision

- Provider identity is always `AUVIK`.
- Adapter type is `auvik-api-v2`.
- Every saved connection has a connection-specific source adapter ID:
  `auvik-api-v2:<InventorySource.id>`.
- Device inventory is normalized through `InventorySourceAdapter` and staged
  with `stageImporterV2NormalizedSource()`.
- No Auvik-specific Device publication path exists.
- Device crosswalk continuity remains provider-scoped so XLSX and API
  observations can converge on the same canonical device.
- API source rule/profile scope uses the stable `InventorySource.id`; it does
  not fabricate XLSX worksheet/header metadata.
- Tenant fan-out is sequential in the first slice to keep rate-limit behavior
  predictable.
- Current/observed inventory is source-owned. Desired firmware, minimum
  firmware, exceptions, planning, customer decisions and EOL policy remain
  NOC Orchestrator-owned.

## Authentication and secrets

`InventorySource.configuration` remains non-secret.

A one-to-one `InventorySourceSecret` record stores an AES-256-GCM encrypted
JSON envelope. Encryption uses Node's built-in crypto module and a dedicated
server-only `INVENTORY_SOURCE_SECRET_KEY` (base64-encoded 32-byte key).
The source ID is authenticated as additional data, preventing encrypted
credential envelopes from being moved between source records.

Credentials are never returned from server-side stores or APIs after saving.

A new connection is disabled. It must pass the Auvik credential verification
endpoint before it can be enabled, and region/credential changes invalidate the
previous successful test.

## Auvik protocol behavior

- Device inventory: `GET /v2/api/inventory/device/info`
- Tenant query parameter: singular `tenant`
- Page size: `page[first]=1000`
- Tenant discovery: `GET /v1/tenants`
- Credential verification: `GET /authentication/verify`
- Accept: `application/vnd.api+json`
- Redirect handling is manual. A 308 is surfaced with a trusted Auvik region
  suggestion; credentials are never automatically forwarded to another host.
- Pagination URLs must remain HTTPS on the configured Auvik API host.
- 400/401/403/404 are not automatically retried.
- 5xx responses use bounded exponential backoff.
- 429 is marked retryable but is deferred to the sync/job layer rather than
  tight-looped inside the HTTP client because Auvik rate limiting uses a
  five-minute window.

## Reuse

No maintained official TypeScript Auvik SDK was identified for this codebase.
The adapter therefore uses the platform `fetch` API and Node crypto rather
than adding a new runtime dependency.

A third-party generated Go client (`github.com/stellaraf/go-auvik`,
BSD-3-Clause-Clear) was inspected only as a schema reference for tenant
attributes; it is not copied or linked into the runtime.

## Follow-up slices

- durable sync run history;
- editable pg-boss schedule;
- persisted/per-run ignore controls;
- overlap prevention/idempotent job execution;
- multi-source evidence/precedence UX;
- richer tenant-to-canonical hierarchy mapping workflow.
