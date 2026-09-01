# Model families / series and bulk desired firmware

NOC Orchestrator distinguishes a vendor marketing family / series from the concrete hardware model installed in inventory.

## Domain shape

```text
Vendor
  └─ DeviceModelFamily (optional grouping)
       └─ DeviceModel (concrete hardware variant)
            └─ Device
```

Examples:

```text
Aruba
  └─ 2530
       ├─ 2530-24G
       ├─ 2530-48G
       └─ 2530-48G-PoE+
```

A `Device` always references a concrete `DeviceModel`. A generic family such as `2530` is not an inventory model.

Family membership is explicit through `DeviceModel.familyId`. The application never guesses membership from model-name prefixes.

Family names are scoped to a vendor. The same family label may exist under different vendors.

## Firmware compatibility remains concrete

`DeviceModel.platform` remains the firmware-compatibility field. A family does not imply that every variant has identical firmware compatibility.

When an exact desired firmware release is selected for one or more models:

- the release must belong to the same vendor as every selected model;
- if a concrete model defines `platform`, that platform must match the release platform after normalization;
- a model without a platform keeps the existing vendor-only compatibility behavior;
- the release must be active;
- a new desired target must be `APPROVED` or `RECOMMENDED`.

Archived or reclassified releases can remain referenced by historical/existing policy rows but are not selectable as a new target.

## No family-level firmware inheritance

A family is organizational context only.

There is no family-level desired-firmware policy and no automatic inheritance in this implementation. Changing a family's name, membership, or metadata does not change the desired firmware of any concrete model.

Desired firmware remains:

```text
DeviceModel -> exact FirmwareRelease
```

The family workflow simply makes it easy to select all or some concrete variants and explicitly update those model policies.

## Bulk desired-firmware actions

The model overview supports selecting multiple concrete models and either:

- setting one exact desired release; or
- clearing the active desired-firmware policy.

For a bulk set, the UI offers only releases compatible with every selected model. A mixed-vendor selection therefore has no valid target. The backend independently validates the full selection so API callers cannot bypass the UI rules.

Bulk clear is allowed across mixed vendors because it does not introduce a firmware compatibility relationship.

## Atomicity and history

Bulk set and clear run inside one database transaction. Validation occurs before writes begin.

For each model that changes:

1. the previous active model-baseline policy is marked inactive;
2. a new exact policy row is created for set operations (clear creates no replacement row);
3. a firmware-policy audit event is appended.

Old policy rows are never deleted. If any write in the transaction fails, the database transaction rolls the whole bulk operation back.

Models that already have the selected exact desired release are reported as unchanged and do not receive duplicate policy/audit rows.

## API

Family / series management:

- `GET /api/v1/model-families`
- `POST /api/v1/model-families`
- `GET /api/v1/model-families/:id`
- `PATCH /api/v1/model-families/:id`
- `DELETE /api/v1/model-families/:id`

Bulk desired firmware:

- `PUT /api/v1/models/bulk-desired-firmware`
  - body: `{ "modelIds": ["..."], "firmwareReleaseId": "..." }`
- `DELETE /api/v1/models/bulk-desired-firmware`
  - body: `{ "modelIds": ["..."] }`

The existing single-model desired-firmware endpoint uses the same persistence/validation path as bulk operations.

## Migration

Issue #30 adds:

- `DeviceModelFamily`;
- optional `DeviceModel.familyId`;
- vendor/family relations and supporting indexes.

Apply with the normal project migration command before running the updated application.
