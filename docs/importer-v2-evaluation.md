# Importer v2 staged evaluation

Issue #45 adds the pure evaluation boundary for Importer v2. The implementation is `evaluateImporterV2` in `src/lib/importer-v2-evaluator.ts`.

## Purpose

Evaluation turns staged source evidence plus immutable snapshots into proposed canonical values. It does not parse an XLSX archive, query a database, save a batch, create catalog records, update inventory, or publish devices.

The caller supplies all input as plain data:

- staged rows with raw values;
- a confirmed source-profile snapshot;
- a canonical catalog snapshot;
- a versioned rule snapshot;
- versioned deterministic parser definitions;
- versioned non-binding suggestions;
- optional existing-record comparisons supplied by a later identity service.

The returned result is also plain data. Repeating evaluation with the same input returns the same rows, decisions, statuses, issues, and evaluation fingerprint.

## Quarantine boundary

The evaluator has no Prisma, API, store, clock, random-number, or network dependency. It cannot write canonical data.

Future upload, stage, refresh, assist, validate, and preview handlers must follow this flow:

1. read canonical records into an immutable snapshot;
2. read rules and parser versions into immutable snapshots;
3. call `evaluateImporterV2`;
4. persist only staged inputs and evaluation output;
5. leave every canonical table unchanged.

Missing canonical values are returned as proposals with `id: null`. A later publication issue owns explicit creation and inventory writes.

## Evidence model

Every evaluated field contains:

- the untouched raw value;
- a separately normalized value;
- a proposed canonical value;
- decision source and `HIGH`, `MEDIUM`, or `LOW` confidence;
- a human-readable explanation;
- whether confirmation is still required;
- matched rule, parser, catalog, or suggestion identifiers and versions;
- warnings and errors attached to that field and source row.

Normalization uses Unicode NFKC, trims surrounding whitespace, and collapses repeated internal whitespace. It never changes `rawValue`.

Firmware Version and Software Version are separate fields. The evaluator does not choose one as Current Firmware unless a manual override, remembered mapping, rule, or parser definition explicitly proposes that decision.

## Decision precedence

For each field, the first matching layer wins:

| Priority | Layer                    | Default confidence    | Confirmation                   |
| -------: | ------------------------ | --------------------- | ------------------------------ |
|        1 | Manual row override      | High                  | Already confirmed              |
|        2 | Remembered exact mapping | High                  | Required for this import       |
|        3 | Active profile rule      | Medium                | Required                       |
|        4 | Deterministic parser     | Medium                | Required                       |
|        5 | Exact catalog match      | High                  | Required                       |
|        6 | Non-binding suggestion   | Supplied by suggester | Required                       |
|        7 | Unresolved proposal      | Low                   | Must be resolved when required |

Within profile rules, parsers, and suggestions, an exact condition is more specific than `starts with`, which is more specific than `contains`. Longer conditions win inside the same operator. Equally specific candidates that propose different targets produce a field-level `AMBIGUOUS_DECISION` error instead of silently choosing one.

The confirmation behavior implements the selected product policy: matches are suggested, not automatically accepted. A manual override is the only decision already confirmed for that row.

## Status model

Readiness and inventory change are separate axes:

- readiness: `VALID`, `WARNING`, or `NEEDS_REVIEW`;
- change: `NEW`, `UPDATE`, or `UNCHANGED`;
- inclusion: `EXCLUDED` only after a separate explicit manual or profile-rule decision.

A row can therefore be `WARNING` and `UPDATE`, or `NEEDS_REVIEW` and `NEW`. Field warnings never exclude a row.

An unresolved configured required field is an error. An unresolved field listed in `warnWhenUnresolvedFields` is a warning. This permits source profiles to treat unknown Current Firmware as optional while the NOC Orchestrator inventory profile can enforce the accepted requirement that Current Firmware must be resolved before publication.

## Fingerprints

The source fingerprint is a SHA-256 digest of:

- provider;
- source-adapter identifier;
- optional stable source-record key;
- complete raw field values in stable key order.

It intentionally excludes workbook filename and row number. It is stable when a file is renamed or a source row moves. It is evidence identity for evaluation and must not be confused with the later device-identity decision, which uses source ID, serial number, and MAC address.

The evaluation fingerprint additionally covers profile, catalog, rule, parser, suggestion, and row snapshots. It makes stale evaluations detectable without relying on time or mutable state.

## Current limitations

- Source-profile recognition and hierarchy parsing belong to Issue #46.
- Device identity and confidence across import runs belong to a later issue.
- Rule authoring and management UI are out of scope.
- The final device grid is out of scope.
- Canonical creation and publication are out of scope.
