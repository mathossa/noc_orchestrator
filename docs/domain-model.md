# Core domain model

This document defines the v0.1.0 persistence boundaries of NOC Orchestrator.

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
ContractType 1 ---- * Customer 1 ---- * Site
                         |              |
                         |              +---- * Device (optional site assignment)
                         |
                         +---- * Device * ---- 1 DeviceModel
                                      |                  |   |
                                      |                  |   +---- 1 DeviceType
                                      |                  +-------- 1 Vendor
                                      |
                                      +---- 0..1 current FirmwareRelease
                                      +---- 0..1 FirmwareLifecycleRecord

Vendor 1 ---- * FirmwareTrain 1 ---- * FirmwareRelease
   |                                  ^
   +----------------------------------+

FirmwarePolicy ---- 1 exact target FirmwareRelease
       |
       +---- optional scope references reserved for:
             DeviceModel / Customer / ContractType / Device / Vendor / DeviceType
```

### Customer

A customer may reference one configurable `ContractType`. Contract types are records, not a fixed application enum, so organizations can define their own commercial/service categories.

A customer can exist without an external system. Manual ownership is a first-class state.

A customer may have zero, one, or many `Site` records.

### Site / customer location

A `Site` belongs to exactly one customer and represents a physical or logical customer location.

Only the site name is required. Optional address fields support partial information such as a city, campus, branch, datacenter, or region without requiring a complete postal address.

Site names are normalized for duplicate prevention within one customer. Optional site codes are also customer-scoped.

A device may have no site. When `Device.siteId` is present, application code must verify that the selected site belongs to the same customer as the device. The shared `assertSiteBelongsToCustomer()` guard is the canonical ownership check for device create/update workflows.

Site archival never moves or detaches devices. Permanent deletion is blocked when devices or audit history depend on the site.

### Vendor, device type, and device model

`Vendor` and `DeviceType` are configurable reference data.

A `DeviceModel` belongs to exactly one vendor and one device type. Device-model identity is vendor-scoped.

### Device

A device belongs to one customer and one device model. `siteId` is optional so a manually entered or newly synchronized device can exist before its customer location is known.

`currentFirmwareReleaseId` is also optional so inventory can exist before current firmware is known.

Current firmware points at a `FirmwareRelease` record instead of duplicating the version string on the device. If a future API reports a version that is not yet in the catalog, synchronization can create/upsert the corresponding firmware-release record and then reference it.

`currentFirmwareObservedAt` and `currentFirmwareSource` describe the current-firmware observation separately from the provenance of the device inventory record itself.

### Firmware train and release

A firmware train/release family is an explicitly managed grouping such as `8.13.x` or `17.15.x`. A train belongs to one vendor and platform/family.

A firmware release belongs to a vendor and may belong to zero or one compatible train. Release versions remain opaque vendor strings; NOC Orchestrator does not infer train membership or semantic-version ordering from the version text.

Catalog status, archive state, and desired-state policy remain separate concepts.

### Desired firmware policy

`FirmwarePolicy.targetFirmwareReleaseId` is an **exact desired release**. It is never stored on `Device.currentFirmwareReleaseId` and is never moved automatically because a newer release appears in a train.

Issue #9 initially creates model-level policies by setting only `deviceModelId` as the policy scope.

The nullable scope references intentionally reserve a compatible path for later precedence rules without replacing the table:

1. device override
2. customer + model override
3. contract + model override
4. model baseline
5. future vendor/device-type defaults if required

Until a later issue explicitly adds override behavior, application code should only create model-level policies.

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

`AuditEvent` is append-oriented history for domain changes. `entityType` + `entityId` support multiple domain entities, including sites, without a destructive schema change every time a new auditable entity is introduced.

`before`, `after`, and `metadata` are JSON snapshots/context. `actorUserId` and `customerId` are optional so system/import operations and deleted actors can still leave durable history.

Issue #12 defines the concrete event-writing behavior.

## Provenance and synchronization

The initial conceptual source values are:

- `MANUAL`
- `API`
- `IMPORT`

They are stored as strings rather than a PostgreSQL enum so later provider/source categories remain extensible.

Synced-capable records expose:

- `source`
- `externalProvider`
- `externalId`
- `lastSynchronizedAt`
- `sourceMetadata`

Manual records require neither `externalProvider` nor `externalId`. Provider/ID pairs are indexed for future synchronization lookup.

Provenance is present on `Customer`, `Site`, `DeviceModel`, `Device`, `FirmwareTrain`, and `FirmwareRelease`, which are the records most likely to be discovered or enriched by future source-of-truth/inventory/network-management integrations.

NOC Orchestrator-owned state such as desired policy, lifecycle decisions, and audit history is deliberately separate from synchronized inventory fields so a future sync does not overwrite orchestration decisions.

## Ownership and deletion

Reference/domain relationships generally use restrictive deletion. Records should normally be deactivated rather than hard-deleted once referenced. This protects inventory, firmware history, and policy integrity.

A customer cannot be permanently deleted while sites, devices, policies, or customer audit history reference it. A site cannot be permanently deleted while devices or site audit history reference it.

Deleting a device cascades only its current `FirmwareLifecycleRecord`; generic `AuditEvent` history remains append-oriented and is not cascade-deleted.

## Filtering/index strategy

Indexes are present for dimensions expected by later MVP filtering:

- customer
- site/location
- contract type
- vendor
- device type
- device model
- current firmware release
- firmware train
- firmware release version/status
- provenance/source and external provider/ID lookup
- active/inactive state
- lifecycle workflow state
- planned/review dates

Uniqueness constraints protect canonical reference values, customer-scoped site identity, model identity, release/train identity, per-customer device name, and the one-current-lifecycle-record-per-device rule.

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
