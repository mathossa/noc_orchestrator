# Importer v2 QA and atomic publication

Issue #51 adds the only supported boundary from staged Importer v2 reconciliation into canonical inventory.

## QA snapshot

`GET /api/v1/device-import-v2/batches/:batchId/publication` builds QA from the immutable evaluator JSON plus append-only workspace decisions. The returned `qaFingerprint` pins the batch evaluation fingerprint, row inclusion, row review revision, and already-published state. A later correction changes the fingerprint and makes an earlier publish request stale.

QA reports validation/status counts, direct field findings, identity conflicts, catalog proposals, rule/parser/manual-decision evidence, repeat-import classifications, and firmware assurance. Firmware assurance keeps raw Firmware Version and Software Version separate from the effective running-version proposal.

Canonical values with no canonical ID are proposals, not implicit creates. Every proposal required by the selected publication rows has a deterministic proposal key and must be explicitly approved in the publish request.

## Publication modes

`ALL_RESOLVED` publishes every currently unpublished included row that has no blocking validation, re-evaluation, or identity review. It refuses to run while any included unpublished row remains unresolved.

`VALID_ONLY` publishes only rows whose current primary status is `VALID`. Warnings and unresolved rows remain staged. Excluded rows remain explicitly excluded and are never converted from unresolved state by publication.

Rows successfully published by an earlier partial attempt are skipped by later attempts.

## Transaction and idempotency

`POST /api/v1/device-import-v2/batches/:batchId/publication` requires:

- publication mode;
- the reviewed `qaFingerprint`;
- a client idempotency key;
- the approved canonical proposal keys.

The server opens one serializable Prisma transaction. Inside the transaction it rebuilds QA, verifies the same fingerprint, revalidates canonical hierarchy and durable identity, applies approved canonical proposals, creates or updates devices, writes observed firmware, updates the provider crosswalk, writes a successful source snapshot, appends audit events, marks published workspace rows, and finalizes the publication attempt/batch status.

A required-write failure rolls the complete transaction back. A retry with the same batch/idempotency key returns the previously committed result and does not repeat device writes.

## Source snapshots and partial publication

A partial publication snapshot contains the rows synchronized successfully for the current evaluated batch plus explicit exclusions. Later partial attempts for the same evaluation copy that successful baseline and add the newly published rows. Rows from an older evaluation are never carried forward as if they appeared in the new source.

Partial snapshots are not marked as full-inventory exports. Missing-device lifecycle automation remains out of scope.

## Ownership boundary

Importer publication writes observed/source-owned inventory only. Existing device lifecycle rows, desired/recommended firmware policy, maintenance/planning state, reporting state, and prior audit events are not updated.

For repeat imports, non-firmware device fields are updated only when the repeat-diff proposal marks that field as source-owned/allowed. Manual-protected fields are preserved. Running firmware evidence is source observation and can be refreshed independently.

A newly observed firmware release is created with:

- `catalogState = OBSERVED`;
- `policyEligibility = NOT_EVALUATED`;
- legacy `status = AVAILABLE`.

It is never made preferred, recommended, or desired by import publication. A canonical release link on the device is written only when the immutable firmware evaluation marked the model/platform interpretation compatible; raw observed evidence is preserved even when no canonical release is linked.
