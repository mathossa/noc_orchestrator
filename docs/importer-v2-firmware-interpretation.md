# Importer v2 deterministic firmware interpretation

Issue #48 defines the single firmware interpretation boundary for Importer v2. The importer must preserve source evidence exactly, derive observed running firmware deterministically, and make the proof reviewable before any canonical publication can occur.

## Boundary

`interpretImporterV2Firmware()` in `src/lib/importer-v2-firmware.ts` is the only component allowed to decide which source firmware evidence represents the observed running version or to propose a software platform from that evidence.

`evaluateImporterV2WithFirmware()` in `src/lib/importer-v2-firmware-evaluation.ts` is the canonical Importer v2 evaluation facade for staging, validation and preview whenever firmware is present. Publication consumes the reviewed interpretation through `buildImporterV2FirmwarePublicationProposals()` rather than parsing the raw columns again.

The lower-level `evaluateImporterV2()` remains the generic field evaluator from Issue #45. It does not become an alternate firmware chooser: the firmware facade replaces its `currentFirmware` and `softwarePlatform` proposals with output from the centralized interpreter.

## Raw evidence and interpreted values

Raw evidence is immutable and retained separately:

- provider;
- vendor;
- model;
- product family;
- source device type;
- source software platform;
- Firmware Version;
- Software Version;
- provider-specific metadata.

Interpretation produces:

- observed running version or `null` when it cannot be proven;
- staged proposed software platform or `null`;
- interpreter ID and version;
- deterministic decision ID;
- confidence;
- human-readable explanation;
- compatibility result and rule ID;
- warnings/conflicts;
- an explicit confirmation requirement.

The interpreter never mutates the raw evidence.

## Deterministic precedence

Importer v2 does not implement a generic “Firmware Version wins” or “Software Version wins” rule.

Known evidence patterns are handled explicitly:

- a blank Firmware Version with a parseable Software Version uses Software Version;
- configured placeholder firmware values such as `0.1` are retained as evidence but ignored as a running-version candidate;
- Cisco ROMMON/bootstrap syntax such as `16.12(3r)` and `17.5(1r)` is never treated as the running IOS/IOS-XE release when a running Software Version is available;
- Aruba AOS-S boot/firmware evidence such as `WC.16.01.0010` is separated from a differing running Software Version such as `WC.16.11.0002`;
- Aruba WLAN major 8 and 10 platform proposals require wireless/deployment evidence plus the running version; model name alone is insufficient;
- FortiGate, FortiSwitch and FortiAP verbose source strings are normalized to their observed release token while preserving the verbose raw value;
- two verbose values that normalize to the same release are accepted as the same deterministic evidence pattern;
- two differing version candidates without a vendor-specific deterministic rule remain unresolved.

Unknown or conflicting running firmware therefore becomes a visible warning, not an exclusion and not a guessed release.

## Platform compatibility

Platform inference and model compatibility are separate operations.

A platform can be proposed from explicit source platform data, version/deployment evidence or source device type. Product family is never used to prove compatibility. Model name alone is never used to infer a high-confidence platform.

After a platform is proposed, the versioned compatibility snapshot is checked for the exact model. The result is one of:

- `COMPATIBLE`;
- `INCOMPATIBLE`;
- `UNKNOWN` when no exact model rule exists;
- `NOT_APPLICABLE` when no platform was proposed.

An incompatible deterministic proposal remains visible but is downgraded to low confidence with a warning. An engineer may explicitly correct/override the proof group; the corrected platform is checked against the same compatibility snapshot so the override does not silently bypass compatibility evidence.

## No fuzzy acceptance or canonical creation

The interpreter emits only staged text proposals. `currentFirmware` and `softwarePlatform` proposals have no canonical IDs at this stage.

Fuzzy catalog suggestions from the generic evaluator cannot become the interpreted running release. The firmware facade deliberately replaces firmware proposals with the centralized deterministic result, with `id: null` and confirmation required.

No firmware release or software platform is created, updated or linked during interpretation/staging. After proof approval, the publication helper can only emit an observed-state proposal:

- `observedRunningVersion`;
- `proposedSoftwarePlatform`;
- `canonicalReleaseId: null`;
- `canonicalPlatformId: null`;
- `observedReleaseState: OBSERVED_AVAILABLE`.

Canonical publication/linking is owned by Issue #51. An observed release does not become desired, recommended or preferred firmware.

## Firmware proof groups

Rows are grouped by the normalized evidence that produced the same deterministic outcome, including vendor, model, source platform, raw Firmware Version, raw Software Version, interpreted running version, proposed platform, interpreter decision and compatibility result.

Each group exposes:

- exact row count;
- row numbers;
- affected customers;
- affected models;
- sample devices;
- the full interpretation/proof.

Every group requires engineer confirmation. One `APPROVE` decision applies to every matching row. One `CORRECT` decision applies the same corrected running version/platform to every matching row and rechecks platform compatibility. Decisions referencing an unknown group or duplicate decisions for one group are rejected.

This is a review convenience, not general rule authoring. Reusable rule authoring remains outside Issue #48.

## Importability of unknown firmware

`evaluateImporterV2WithFirmware()` intentionally removes `currentFirmware` from blocking profile requirements. If running firmware is unknown, the included row receives a warning and remains reviewable/importable.

A required `softwarePlatform` remains different: if no platform can be proposed, it is still a blocking unresolved field. If the interpreter can infer a platform deterministically, that proposal satisfies the staged field but still requires confirmation.

## Regression coverage

Regression tests cover:

- blank and placeholder Firmware Version;
- Cisco ROMMON/bootstrap evidence;
- Aruba AOS-S boot versus running software;
- Aruba WLAN 8.x/10.x inference and multi-platform models;
- FortiGate, FortiSwitch and FortiAP extraction;
- verbose representations of the same release;
- generic conflicting and unknown evidence;
- model-platform compatibility, incompatibility and unknown compatibility;
- product-family non-authority;
- proof grouping, bulk approval and bulk correction;
- staged observed-state publication proposals;
- raw evidence preservation;
- no canonical release/platform creation from the pure interpreter.
