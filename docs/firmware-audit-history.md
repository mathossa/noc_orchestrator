# Firmware lifecycle audit history

NOC Orchestrator keeps an append-oriented history for firmware lifecycle changes that matter operationally. The current device/model records remain the source of present state; `AuditEvent` preserves how that state changed over time.

## Events recorded in v0.1

The audit trail intentionally focuses on lifecycle-significant events instead of generic CRUD noise:

- `DESIRED_FIRMWARE_CHANGED` — a model's exact desired release was set or changed.
- `DESIRED_FIRMWARE_CLEARED` — a model's desired release was explicitly cleared.
- `CURRENT_FIRMWARE_CHANGED` — a device's recorded current firmware release, observation timestamp, or firmware source changed. An initial current firmware recorded when creating a device is also captured.
- `FIRMWARE_LIFECYCLE_PLANNED`
- `FIRMWARE_LIFECYCLE_IGNORED`
- `FIRMWARE_LIFECYCLE_CUSTOMER_DECLINED`
- `FIRMWARE_LIFECYCLE_DONE`

Changing a hostname, note, management address, archive flag, or other ordinary inventory metadata does not create firmware lifecycle audit noise.

## Event shape

Each audit event can retain:

- action name
- related entity type and ID
- related customer where applicable
- actor/user when an authenticated session exists
- previous values in `before`
- new values in `after`
- contextual metadata
- immutable creation timestamp

Actor identity is optional. Manual/system/API operations may therefore still create a complete audit event when no authenticated user is available.

## Atomic writes

Desired-policy changes, lifecycle decisions, and current-firmware changes create their audit event in the same database transaction as the state change. A successful state write therefore cannot silently omit its corresponding audit entry because of a later application step.

Repeatedly saving the same exact desired firmware is a no-op and does not produce duplicate audit noise. Lifecycle saves are explicit decisions and do append a decision event each time they are saved.

## History views

- `/devices/:id` shows device firmware lifecycle history, including recorded current-firmware changes and lifecycle decisions.
- `/models/:id` shows desired-firmware policy history for that model.

Histories are returned newest-first. The detail API currently returns the latest 50 relevant events; the query store supports a bounded maximum of 200 per request.

## Preservation

Audit events are append-oriented. Updating the current desired policy, current firmware, or lifecycle record does not rewrite older audit rows. Existing device/model deletion safeguards already treat audit history as a reference, encouraging archive rather than destructive deletion of audited entities.
