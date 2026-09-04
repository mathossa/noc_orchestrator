# Firmware release catalog

Issues #7 and #56 define the canonical firmware catalog used by NOC Orchestrator.

## Core rule

A catalog release is **not** automatically desired firmware.

The catalog answers “which exact releases/builds/images do we know about?” Firmware policy separately answers “which releases may or should this scope run?” Inventory/current firmware separately records “what did the source report?”

The ownership boundary is therefore:

```text
Observed/current firmware
        ↓
Canonical firmware catalog
        ↓
Explicit policy eligibility
        ↓
Firmware policy
```

An XLSX/API import may discover or confirm a release without ever changing desired firmware.

## Exact version vs logical release

`FirmwareRelease.version` remains the exact vendor identity and is never normalized destructively.

Issue #56 adds separate grouping metadata:

- `logicalVersion` — the base/logical release used for grouping and supported comparison;
- `variant` — rebuild/suffix that must not be silently discarded;
- `imageCode` — vendor image/software code such as Aruba `WC`, `YA`, or `YB`;
- `variantEquivalence` — explicit rule describing whether variants may later be treated as equivalent for compliance.

Examples:

```text
Exact:   WC.16.11.0002
Logical: 16.11.0002
Image:   WC
```

```text
Exact:   15.2(7)E17a
Logical: 15.2(7)E17
Variant: a
```

The UI may collapse/group these records by logical release, but every exact release remains independently addressable and auditable.

## Release trains

Firmware trains remain explicit catalog records. They are not inferred from the version parser.

Example:

```text
FortiOS / 7.4.x
├── 7.4.7
├── 7.4.9
└── 7.4.12
```

A release may belong to zero or one explicit train. Train membership must match the same vendor and normalized platform/family.

A future policy may deliberately choose `latest approved in train`, but merely observing or adding a newer release must never move desired state.

## Catalog state vs policy eligibility

Issue #7 originally overloaded one `status` field with both catalog facts and policy intent. Issue #56 separates those concepts.

### Catalog state

- `OBSERVED` — known from source evidence but not yet fully verified;
- `VERIFIED` — confirmed canonical release;
- `BLOCKED` — known bad / do not deploy;
- `WITHDRAWN` — withdrawn by vendor or internal policy.

### Policy eligibility

- `NOT_EVALUATED` — catalog record exists but policy has not approved it;
- `ALLOWED` — policy may use the release;
- `PREFERRED` — release is eligible to be used as a preferred target;
- `DISALLOWED` — release must not be selected by policy.

`BLOCKED` and `WITHDRAWN` always force policy eligibility to `DISALLOWED`.

The legacy Issue #7 `status` column remains temporarily for compatibility and audit readability. The migration maps:

| Legacy status | Catalog state | Policy eligibility |
| --- | --- | --- |
| `AVAILABLE` | `VERIFIED` | `NOT_EVALUATED` |
| `TESTING` | `VERIFIED` | `NOT_EVALUATED` |
| `APPROVED` | `VERIFIED` | `ALLOWED` |
| `RECOMMENDED` | `VERIFIED` | `PREFERRED` |
| `DEPRECATED` | `VERIFIED` | `DISALLOWED` |
| `BLOCKED` | `BLOCKED` | `DISALLOWED` |

New policy-selection code uses `catalogState` + `policyEligibility`; the legacy field is no longer authoritative.

## Imported/observed releases

Importer v2 remains an observed-inventory workflow.

When a source reports an unknown firmware value:

1. preserve the raw source value;
2. interpret/normalize it separately;
3. link a canonical release only when that is safe;
4. when an engineer explicitly confirms creation of a canonical release, it may become `VERIFIED`;
5. it remains `NOT_EVALUATED` for policy unless an engineer explicitly allows/prefers it.

Import must never set `ALLOWED`, `PREFERRED`, desired firmware, lifecycle decisions, or work planning automatically.

## Device observation evidence

`Device` stores the optional canonical `currentFirmwareReleaseId`, but Issue #56 also reserves independent evidence fields:

- `currentFirmwareRawVersion`;
- `currentFirmwareNormalizedVersion`;
- `currentFirmwareEvidence`;
- `currentFirmwareInterpreterId`;
- `currentFirmwareInterpreterVersion`.

This allows a device to remain importable when the exact source string is known but compatibility/catalog linking is unresolved.

Example:

```text
Raw source:       WC.16.11.0002
Normalized:       16.11.0002
Canonical release: unresolved
Reason:           model/image compatibility requires review
```

The raw observation survives. Issue #48 owns deterministic interpretation and Issue #51 owns canonical publication.

## Safe version ordering

`src/lib/firmware-versioning.ts` is the central comparison boundary for policy ranges and later compliance.

The service:

- requires one vendor/platform ordering domain;
- supports deterministic numeric dotted versions;
- supports Aruba image-prefixed dotted releases by comparing the shared logical numeric release;
- supports Cisco IOS-style `15.2(7)E17` release/build ordering inside the same train;
- does not invent ordering between maintenance rebuild suffixes such as `E17` and `E17a`;
- returns `NOT_COMPARABLE` for unsupported/opaque syntax instead of lexical/SemVer guessing.

This service compares version order only. It does **not** decide whether a concrete hardware model may use an image; Issue #57 owns compatibility/image selection.

## Variant equivalence

Release metadata prepares later compliance for explicit choices:

- `EXACT_ONLY`;
- `ANY_VERIFIED_VARIANT`;
- `ANY_NON_BLOCKED_VARIANT`.

The existence of `15.2(7)E17a` does not automatically make it equivalent to `15.2(7)E17`. Issue #58 must honor the configured equivalence rule.

## UI routes

- `/firmware` manages exact releases, logical grouping metadata, catalog state, policy eligibility, and train membership.
- `/firmware/[id]` shows exact/logical identity, image/variant metadata, usage, and policy eligibility.
- `/firmware/trains` manages explicit release trains.
- `/firmware/trains/[id]` shows releases assigned to a train.

## Model applicability

Issue #56 does not implement the full compatibility engine. Existing model applicability still uses vendor/platform as the current broad foundation.

Issue #57 will add explicit model-family/concrete-model compatibility and automatic image selection. Policy eligibility alone must not be interpreted as proof that every model from the vendor can run the release.

## Deletion and history

Archiving is the safe normal removal path.

Permanent deletion remains blocked when a release is referenced by:

- a device as recorded current firmware;
- a firmware policy;
- a lifecycle decision;
- an audit record.

Exact release identity and historical policy references are never rewritten just because a logical group, catalog state, or future preferred target changes.
