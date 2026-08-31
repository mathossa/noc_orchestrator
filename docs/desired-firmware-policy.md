# Model-level desired firmware policy

Issue #9 introduces the first desired-state policy mechanism for NOC Orchestrator v0.1.0.

## Core rule

**Current state is not desired state.**

A device records the firmware it is currently running. Separately, its model may define one exact desired firmware release.

```text
Device model: Cisco C9300-24P
Desired:      17.15.5

Device:       HQ-SW-01
Current:      17.12.5
Desired:      17.15.5
Technical:    —  (Issue #10)
```

The policy points to the exact `FirmwareRelease` row. Firmware trains remain informational in Issue #9. Adding `17.15.6` to train `17.15.x` does not change a policy targeting `17.15.5`.

## Scope

The v0.1.0 baseline scope is only:

```text
DeviceModel -> exact FirmwareRelease
```

The existing `FirmwarePolicy` entity already reserves nullable scope references for future device, customer/model, contract/model, vendor, and device-type rules. Issue #9 does not implement precedence between those future scopes.

## Target compatibility

A new model desired target must:

1. exist in the firmware catalog;
2. belong to the same vendor as the device model;
3. match the model platform/family after normalization when the model defines one;
4. be active in the catalog;
5. have `APPROVED` or `RECOMMENDED` status.

When a model does not define a platform/family, vendor-compatible releases remain selectable because no narrower family constraint exists.

`AVAILABLE`, `TESTING`, `DEPRECATED`, `BLOCKED`, archived, and other non-normal states are not offered/accepted as new model targets in this MVP.

## Archived or reclassified existing targets

Policy is never silently rewritten because catalog metadata changes.

If an already-selected desired release is later archived or reclassified, the existing policy remains active and visible with a warning. It cannot be selected as a new target, but it remains the exact desired release until an engineer deliberately changes or clears the policy.

This preserves historical and operational integrity.

## Zero or one active model baseline

Changing a model target deactivates the previous policy row and creates a new active row. Clearing desired firmware only deactivates the current row. Historical rows are not deleted.

A PostgreSQL partial unique index guarantees that a model can have at most one active baseline policy where all future override-scope columns are null.

This structure also gives Issue #12 a stable history of policy records to build explicit actor/audit events around later.

## UI and API

Primary UI:

- `/models/[id]` — view, set, change, or clear exact desired firmware
- `/devices/[id]` — resolves and displays desired firmware inherited from the device model

API:

- `PUT /api/v1/models/[id]/desired-firmware` with `{ "firmwareReleaseId": "..." }`
- `DELETE /api/v1/models/[id]/desired-firmware`

The device endpoint returns desired firmware through its model. Issue #9 deliberately does not compare current and desired versions.

## Technical state remains separate

Issue #10 owns canonical technical state such as:

- `CURRENT`
- `ACTION REQUIRED`
- `AHEAD`
- `UNKNOWN`
- `NO POLICY`

Issue #9 therefore provides current + desired while leaving technical state unresolved.

## Future contract-scoped policy

When `Contract + Model` policy is implemented later, contract matching must use the device's effective contract:

```text
site contract override
        ↓
customer default contract
        ↓
no contract
```

It must not resolve only from `Customer.contractTypeId`, because different customer sites can have different service agreements.
