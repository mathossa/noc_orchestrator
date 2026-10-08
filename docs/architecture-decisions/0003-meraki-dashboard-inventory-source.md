# ADR 0003: Cisco Meraki Dashboard as an observed inventory source

Date: 2026-10-08
Status: Accepted for Issue #115

## Context

Issue #115 adds Cisco Meraki Dashboard inventory without creating a second importer,
identity engine, hierarchy mapper, publication path, or scheduler.

Vendor documentation reviewed during implementation:

- Authorization: https://developer.cisco.com/meraki/api-v1/authorization/
- Dashboard API v1: https://developer.cisco.com/meraki/api-v1/
- Organizations: `GET /organizations`
- Organization networks: `GET /organizations/{organizationId}/networks`
- Organization devices: `GET /organizations/{organizationId}/devices`

The network-scoped devices endpoint is deprecated in the current documentation, so
the adapter uses the organization-level bulk endpoint and applies configured network
scope locally.

## Decision

The source boundary is:

```text
Meraki Dashboard API
        ↓
meraki-dashboard-api-v1 adapter
        ↓
normalized Importer v2 rows
        ↓
shared hierarchy + #121 identity + firmware interpretation
        ↓
shared QA / reconciliation / atomic publication
        ↓
canonical inventory
```

Meraki is observed/current state only. It cannot own desired/preferred/minimum
firmware, exceptions, lifecycle decisions, customer approval state, firmware work
plans, maintenance windows, EOL decisions, or NOC notes/issues.

## Authentication and environments

Dashboard API keys are sent with the documented Bearer authentication model and are
stored only through the existing encrypted `InventorySourceSecret` mechanism.
Public connection objects expose only `credentialsConfigured`.

The adapter supports the documented API environments:

- Global: `api.meraki.com`
- Canada: `api.meraki.ca`
- China: `api.meraki.cn`
- India: `api.meraki.in`
- FedRAMP: `api.gov-meraki.com`

Provider response bodies are not copied into errors, logs, run history, or browser
payloads.

## Scope and hierarchy

Accessible organizations are discovered after the connection test. Stable
organization IDs and network IDs are persisted. Display names are context only.

An organization may propose Customer / optional Business Unit context and a network
may propose Site context, but canonical hierarchy resolution remains in Importer v2.
Renaming a Meraki organization or network therefore does not replace its durable
source scope identity.

## Device identity

Meraki's device serial is its stable provider device identity for this adapter. The
same raw serial is supplied as provider `sourceId` and serial evidence; MAC is a
second durable signal when supplied.

No hostname, display name, tag, organization name, or network name is used as a
durable device identity signal.

The cross-provider reconciler from #121 remains authoritative. A first Meraki
observation may converge safely with an existing Auvik/manual/XLSX canonical Device;
publication then stores an additional `MERAKI` crosswalk. Later Meraki syncs resolve
through that same-provider crosswalk. Conflicting serial/MAC evidence remains review
work.

## Inventory normalization

Organization devices are fetched in bulk and normalized where the API supplies them:

- serial / provider identity;
- MAC;
- device name;
- model;
- product type;
- organization and network IDs/names;
- LAN/management IP;
- firmware evidence;
- tags/details as diagnostic raw source evidence.

Known product types map to the existing vocabulary:

- `switch` → Switch
- `wireless` → Access Point
- `appliance` → Firewall

Unsupported product types are not coerced into those categories; their raw type is
left reviewable.

Firmware is preserved as observed evidence and passes through the existing firmware
interpreter/catalog review. The adapter never creates preferred/minimum/desired
policy.

## Pagination, rate limits and partial runs

Meraki RFC Link pagination is followed only while the next URL stays on the
configured HTTPS API origin. Page size is 1000.

429 responses honor `Retry-After` with bounded retry. Transient 5xx responses use
bounded exponential backoff. Permanent 4xx responses such as 401/403 are not retried.
Provider response bodies are deliberately excluded from surfaced errors.

Organization inventories are independent fan-out units. If one organization fails,
successful organizations may still stage, but the run is marked PARTIAL and
`isFullInventoryExport=false`; therefore a missing failed organization cannot be
misinterpreted as canonical inactivity.

## Scheduling and run history

Manual and scheduled syncs call the same `runMerakiInventorySync` service.

- `InventorySyncRun` is provider-neutral durable run history.
- pg-boss owns recurring schedule transport.
- one generic `inventory.sync` job is registered.
- source-level run acquisition rejects overlapping active executions.
- schedule expression and timezone can be edited without redeployment.
- the UI shows next scheduled time plus durable run counts/history.

The worker build rewrites the repository's existing `@/...` TypeScript aliases in
emitted worker JavaScript so the worker can reuse normal application services rather
than copying sync logic.

## SDK evaluation

A maintained Cisco/Meraki TypeScript helper,
`@cisco-meraki/dashboard-api-tools`, was evaluated. Cisco also documents Python as
the preferred Dashboard SDK. No SDK dependency was added here because this adapter
needs only three read-only bulk GET surfaces and the repository already has a
well-tested native-`fetch` provider-client pattern from Auvik. Adding another
runtime dependency would not materially simplify identity, hierarchy, importer,
scheduling, or ownership behavior.

Custom Meraki code is therefore limited to authentication/environment selection,
Meraki pagination/rate-limit behavior, provider response normalization, connection
scope, and UI. Shared NOC Orchestrator components own everything downstream.

## Consequences

- no Meraki-specific canonical publication path;
- no provider priority matrix;
- no firmware execution or configuration management;
- no topology/interface/monitoring collection;
- no new npm dependency;
- future Auvik/Aruba scheduling can reuse the same run-history/job boundary.
