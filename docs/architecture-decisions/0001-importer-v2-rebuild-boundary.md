# ADR 0001: Importer v2 rebuild boundary

- Status: accepted
- Date: 2026-09-04
- Issue: #44

## Context

The Issue #38 prototype proved that large XLSX inventories can be inspected, staged, reconciled, and published. It also accumulated several competing reconciliation screens and mixed parsing, inference, confirmation, and canonical writes. The result is difficult to reason about and makes a repeated import feel like another first import.

Importer v2 starts from current `main`. PR #42 and `issue/38-xlsx-device-import` remain read-only references until the replacement reaches parity. No production implementation is copied wholesale.

The supplied workbook is used only to identify data shapes. Customer names, addresses, serial numbers, MAC addresses, source identifiers, and IP addresses from it must not be committed.

## Decision

Importer v2 is a reviewable inventory synchronization engine, not a sequence of entity-specific wizards. It will propose changes and reusable rules, but an importer must confirm every match or change before publication.

Issue #44 only establishes this boundary, synthetic regression data, and a repeatable performance baseline. It does not build the production evaluator or UI.

### Retained from the prototype

- bounded XLSX/ZIP parsing with explicit file, worksheet, column, row-coordinate, and expanded-content limits;
- raw source evidence alongside normalized values;
- server-side staged batches and rows as a quarantine boundary;
- canonical inventory changes only through an explicit publication transaction;
- deterministic parsing helpers for firmware text, Cisco ROMMON/bootstrap evidence, Aruba AOS-S boot/running pairs, and placeholder versions, after independent tests prove each helper;
- bounded browser payloads and server-side work suitable for imports larger than 10,000 rows;
- saved source profiles and visible reuse of column mappings.

Staging persistence changes meaning in v2. A newly uploaded, uncommitted import is disposable when the user leaves. If ready rows are partially committed, unresolved rows are copied into a new resumable follow-up import with their evidence and decision history intact.

### Replaced from the prototype

- canonical writes while staging or resolving;
- filename-dependent repeat-import recognition;
- hostname, device name, management IP, model, or site as device identity;
- automatic selection of Firmware Version over Software Version, or the reverse;
- entity-by-entity modal workflows and duplicate reconciliation workspaces;
- row-level ignore as a substitute for correcting one field;
- implicit creation of reusable rules from every manual decision;
- global recomputation or full-table browser rendering after a local action.

### Target review workspace

The future UI uses one flat, sortable device table and a sticky right-side panel. The panel shows shared values and differences, available bulk actions, before/after values, rule scope and affected rows, and blocking warnings. Confirmation is supported per field, per complete row, and across selected rows with an identical decision.

The workspace may suggest saving a reusable rule when many rows share a decision. Saving a rule remains explicit. A completed import is reversible as one audited operation.

### Hierarchy and source profiles

The hierarchy is:

`Customer -> Business unit -> Site`

A workbook may be scoped to one customer or contain multiple customers. A missing business unit or site may be linked to an existing record or explicitly created. Source-profile detection is a suggestion that requires confirmation; when no profile matches, the importer offers to create one. Reused column mappings are always shown before analysis.

### Identity

Only these durable identifiers contribute to device identity:

1. external provider plus source-system device ID;
2. serial number;
3. MAC address.

At least one is required to create a device. Multiple signals produce `HIGH`, `MEDIUM`, or `LOW` confidence. If strong identifiers point to different devices, the row is a conflict. The importer may choose a candidate, create a new device, or explicitly override with a warning. Hostname, IP address, hierarchy, vendor, and model remain evidence, never identity.

Duplicate source rows with differing values are conflicts. They are not silently merged.

### Matching, confirmation, and rules

Customer/site, vendor/exact model, and current firmware release or train must be resolved before normal publication. Unknown values can be linked, explicitly created, intentionally ignored, or left unresolved so that only the affected device remains blocked.

Rules can:

- normalize raw values;
- map raw values to canonical records;
- choose Firmware Version or Software Version;
- ignore a known value or field;
- derive customer, business unit, or site;
- match product family and software platform.

The most specific matching rule wins. Rule management must preview affected rows, allow edit/disable, show where and when a rule was used, warn about overlaps, and undo a newly applied rule. Confirmed decisions apply to identical values in the current import and can be saved for the customer or for every customer using the same source format.

`Ignore field`, `exclude this row`, and `always exclude matching rows` are separate, explicit actions.

### Firmware evidence

Firmware Version and Software Version remain visible as independent raw evidence. The importer does not silently decide which is running firmware; the user can confirm the choice for a field, row, or selected group. Firmware suggestions show raw and normalized values, matched platform/train/release, the reason for the suggestion, compatibility warnings, and every row affected by the same rule.

Compatibility is based on vendor plus software platform and product family plus software platform. An unknown version may be proposed as a new release and becomes verified when the importer explicitly confirms its creation. A compatibility conflict can either keep the raw observed value without linking a release or be manually overridden. Inventory import never changes desired firmware policy.

### Synchronization and publication

Publication produces a reviewable proposal that can update source-owned fields and fill blank canonical fields. Manual values are protected by default. The latest confirmed import always becomes the device's observed current firmware.

Existing devices missing from an import are proposed as inactive only when the upload is explicitly marked as a full-inventory export. No scope is inferred from filename or contents. Unmanaged and end-of-life devices are imported and flagged separately.

Ready devices can be committed while unresolved rows remain. The selected commit is atomic: any database error rolls it back completely. Anyone with import permission may create the records and rules needed by the import.

Every committed import records the filename and timestamp, actor and confirmations, rules used or created, every created or changed device, and before/after values. Undo reverses the complete import through that audit record.

### Performance contract

The reference data set contains 12,000 synthetic rows and represents the data shapes found in the approximately 11,816-row source workbook.

- Full server-side analysis (stage, evaluate, and validate) must complete within 30 seconds in the documented baseline environment.
- Filtering, sorting, selecting, and opening the bulk-action panel must complete in under one second at p95.
- Publication is measured separately because database and audit I/O dominate it; the selected atomic publication must also target 30 seconds for 12,000 ready rows.
- Browser payloads remain bounded or virtualized. Meeting the interaction target by sending and rendering every row at once is not acceptable.

`npm run benchmark:importer-v2` records CPU reference timings for stage, evaluate, filter, validate, and publish-plan construction. It intentionally excludes XLSX decompression and database I/O; later issues must extend the same fixture and phase names with integration measurements rather than replacing them.

## Prototype batch migration

There is no production importer data. Unfinished prototype batches require no migration and may be discarded when the prototype schema is retired. The prototype branch and draft PR remain available as source-code history.

## Consequences

- Later importer issues can replace individual components without inheriting prototype UI or reconciliation behavior.
- Every inferred value stays explainable and reviewable.
- Repeat imports improve through scoped rules and stable identity instead of filenames.
- Atomic publication, complete undo, and field provenance require deliberate audit and schema design in later issues.
- Business unit is a required hierarchy concept and must be added to the canonical domain before the v2 importer can publish that hierarchy.
