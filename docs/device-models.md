# Device model management

Issue #6 implements the v0.1.0 device-model catalog used to connect inventory to vendor, device type, firmware releases, and desired-state policy. Issue #9 adds the first model-level desired firmware baseline.

## Identity

A device model belongs to exactly one vendor and one device type.

Model identity is vendor-scoped:

- `Cisco / C9300-24P` and `Another Vendor / C9300-24P` may coexist.
- Two case/whitespace variants of `C9300-24P` under the same vendor are rejected.
- The entered model label is preserved for display.
- A PostgreSQL expression index additionally enforces case-insensitive, whitespace-normalized uniqueness within a vendor.

This avoids assuming that model names are globally unique or follow one vendor naming convention.

## Model fields

The MVP exposes:

- vendor
- device type
- model name
- optional platform / firmware family
- optional notes
- active/archive state
- source/provenance (`MANUAL`, `API`, `IMPORT`)
- optional external provider and external ID
- synchronization timestamp when future integrations populate it

Manual models require no external provider or external ID.

## List behavior

`/models` supports:

- search
- vendor filter
- device-type filter
- optional grouping by vendor or device type
- create/edit/archive/reactivate/delete actions

Archived models remain visible so historical inventory and lifecycle references do not disappear.

## Model detail

`/models/[id]` is firmware-lifecycle focused and shows:

- vendor and device type
- devices using the model
- customers using the model
- exact desired firmware baseline when configured
- recorded current firmware distribution
- workflow-state distribution
- catalog releases matching the same vendor and platform/firmware family when defined
- provenance/synchronization context

Desired firmware is an explicit exact release, never inferred from the newest catalog release or newest release in a train. Normal new choices are active `APPROVED` and `RECOMMENDED` releases. Existing archived/reclassified targets remain visible until deliberately changed or cleared.

See `docs/desired-firmware-policy.md` for policy semantics and future-scope constraints.

Catalog releases remain informational until an engineer explicitly saves one as desired.

No generic monitoring/health data is introduced.

## Deletion

Permanent deletion is blocked when the model is referenced by:

- devices
- firmware policies
- model audit events

Archiving is the normal safe action for historical models.
