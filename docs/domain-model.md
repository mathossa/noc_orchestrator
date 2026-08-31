# Core domain model

This document defines the v0.1.0 persistence boundaries introduced by Issue #2.

## Core principle

NOC Orchestrator stores **recorded current firmware** separately from **desired firmware policy**.

```text
Device.currentFirmwareRelease
              |
              | compare later (Issue #10)
              v
FirmwarePolicy.targetFirmwareRelease
```

Technical/compliance state such as `CURRENT`, `ACTION REQUIRED`, `UNKNOWN`, or `NO POLICY` is intentionally **not persisted** in the core schema. It is derived from current state plus the effective desired policy so it cannot become stale independently.

Workflow state is a separate concern and is persisted in `FirmwareLifecycleRecord`.

## Relationships

```text
ContractType 1 ---- * Customer 1 ---- * Device * ---- 1 DeviceModel
                                           |                  |   |
                                           |                  |   +---- 1 DeviceType
                                           |                  +-------- 1 Vendor
                                           |
                                           +---- 0..1 current FirmwareRelease
                                           +---- 0..1 FirmwareLifecycleRecord

Vendor 1 ---- * FirmwareRelease

FirmwarePolicy ---- 1 target FirmwareRelease
       |
       +---- optional scope references reserved for:
             DeviceModel / Customer / ContractType / Device / Vendor / DeviceType
```

### Customer

A customer may reference one configurable `ContractType`. Contract types are records, not a fixed application enum, so organizations can define their own commercial/service categories.

A customer can exist without an external system. Manual ownership is a first-class state.

### Vendor, device type, and device model

`Vendor` and `DeviceType` are configurable reference data.

A `DeviceModel` belongs to exactly one vendor and one device type. The pair `(vendorId, model)` is unique.

### Device

A device belongs to one customer and one device model. `currentFirmwareReleaseId` is optional so a manually entered or newly synchronized device can exist before its current firmware is known.

Current firmware points at a `FirmwareRelease` record instead of duplicating the version string on the device. If a future API reports a version that is not yet in the catalog, synchronization can create/upsert the corresponding firmware-release record and then reference it.

`currentFirmwareObservedAt` and `currentFirmwareSource` describe the current-firmware observation separately from the provenance of the device inventory record itself.

### Firmware release

A firmware release belongs to a vendor and is uniquely identified in the initial catalog by `(vendorId, platform, version)`. The schema already has fields for filename, SHA-256, file size, release-notes reference, status, notes, and release date so Issue #7 can build the catalog without replacing the underlying model.

### Desired firmware policy

`FirmwarePolicy.targetFirmwareReleaseId` is the desired target. It is never stored on `Device.currentFirmwareReleaseId`.

Issue #9 initially creates **model-level** policies by setting only `deviceModelId` as the policy scope.

The nullable scope references intentionally reserve a compatible path for later precedence rules without replacing the table:

1. device override
2. customer + model override
3. contract + model override
4. model baseline
5. future vendor/device-type defaults if required

Issue #2 does not implement this precedence resolver. Until a later issue explicitly adds override behavior, application code should only create model-level policies.

### Firmware lifecycle record

A device has at most one current `FirmwareLifecycleRecord`. This record stores workflow intent independently of technical firmware state.

MVP states are:

- `PLANNED`
- `IGNORED`
- `CUSTOMER_DECLINED`
- `DONE`

The record also preserves the target firmware release, reason, decision actor/time, optional planned date, optional review date, and completion time.

Changes to lifecycle decisions are intended to be written to `AuditEvent`, allowing the lifecycle row to represent the current workflow decision while audit events preserve history.

### Audit event

`AuditEvent` is append-oriented history for domain changes. `entityType` + `entityId` support multiple domain entities without a destructive schema change every time a new auditable entity is introduced.

`before`, `after`, and `metadata` are JSON snapshots/context. `actorUserId` and `customerId` are optional so system/import operations and deleted actors can still leave durable history.

Issue #12 defines the concrete event-writing behavior.

## Provenance and synchronization

The initial conceptual source values are:

- `MANUAL`
- `API`
- `IMPORT`

They are stored as strings rather than a PostgreSQL enum. This keeps the persistence model extensible for later provider/source categories.

Synced-capable records expose:

- `source`
- `externalProvider`
- `externalId`
- `lastSynchronizedAt`
- `sourceMetadata`

The `(externalProvider, externalId)` pair is unique per entity table when populated. Manual records require neither field.

Provenance is present on `Customer`, `DeviceModel`, `Device`, and `FirmwareRelease`, which are the records most likely to be discovered or enriched by a future source-of-truth/inventory/network-management integration.

NOC Orchestrator-owned state such as desired policy, lifecycle decisions, and audit history is deliberately separate from those synchronized inventory fields so a future sync does not need to overwrite orchestration decisions.

## Ownership and deletion

Reference/domain relationships generally use restrictive deletion. Records should normally be deactivated rather than hard-deleted once referenced. This protects firmware history and policy integrity.

Deleting a device cascades only its current `FirmwareLifecycleRecord`; generic `AuditEvent` history remains append-oriented and is not cascade-deleted.

## Filtering/index strategy

Indexes are present for the dimensions expected by later MVP filtering:

- customer
- contract type
- vendor
- device type
- device model
- current firmware release
- firmware release version/status
- provenance/source
- active/inactive state
- lifecycle workflow state
- planned/review dates

Uniqueness constraints protect canonical reference values, model identity, release identity, per-customer device identity, external identities, and the one-current-lifecycle-record-per-device rule.

## Migration strategy

Migrations are additive and committed under `prisma/migrations`.

For normal development, use:

```bash
npm run prisma:migrate
```

For production/container deployment, use:

```bash
npm run prisma:deploy
```

Applied migrations must not be edited in place. If a schema change is needed later, create a new forward migration.

For a **disposable local development database only**, a clean rebuild can be tested with:

```bash
docker compose down -v
npm run db:up
npm run prisma:generate
npm run prisma:deploy
```

This intentionally deletes the local PostgreSQL volume. Never use that rebuild procedure on an environment containing data that must be retained.

Production rollback is backup/restore or a deliberate compensating forward migration; Prisma migrations are not treated as an automatic down-migration system.
