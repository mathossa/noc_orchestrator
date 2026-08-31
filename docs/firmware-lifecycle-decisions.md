# Firmware lifecycle decisions

Firmware lifecycle decisions are operational workflow state. They are deliberately separate from the technical current-versus-desired firmware state implemented by Issue #10.

## States

- `PLANNED` — a firmware change is intended. `plannedFor` is optional.
- `IGNORED` — the NOC explicitly chooses not to act now. A reason is required and `reviewAt` is optional.
- `CUSTOMER_DECLINED` — the customer declined the change. This is distinct from an internal ignore. A reason is required and `reviewAt` is optional.
- `DONE` — the planned/required firmware work was completed. `completedAt` is recorded when the decision enters Done.

All states may carry optional notes. The API records the authenticated user as the decision actor when a session is available.

## Target snapshot

A lifecycle decision is about a concrete exact firmware target. When a decision is saved, NOC Orchestrator resolves the device's current model-level desired firmware policy and copies that exact `FirmwareRelease` into `FirmwareLifecycleRecord.targetFirmwareReleaseId`.

This snapshot is intentional. If the model's desired policy later changes from release A to release B, an existing lifecycle record still shows that it targeted release A until an engineer explicitly changes/saves the decision again.

Creating or updating a lifecycle decision therefore requires the device to resolve an explicit desired firmware release. Lifecycle records are not destructively cleared in this issue; engineers transition the record among the four explicit workflow states. Issue #12 will add append-only transition/audit history around these changes.

## Technical state remains independent

Workflow state never changes the technical comparison:

- current exact release equals desired exact release → `CURRENT`
- current and desired both exist but differ → `ACTION_REQUIRED`
- desired exists but current is missing → `UNKNOWN`
- no desired policy exists → `NO_POLICY`

For example, an `IGNORED` device can still be technically `ACTION_REQUIRED`, and a `DONE` record remains visible even when the device is technically `CURRENT`.

## API

`PUT /api/v1/devices/:id/lifecycle` creates or changes the current lifecycle decision.

Example body:

```json
{
  "state": "CUSTOMER_DECLINED",
  "reason": "Customer did not approve the maintenance window.",
  "notes": "Revisit during Q4 service review.",
  "reviewAt": "2026-12-01T10:00:00Z"
}
```

The endpoint never modifies current firmware, desired firmware, or technical firmware state.

Issue #12 owns append-only audit/change-history behavior beyond the current structured lifecycle record.
