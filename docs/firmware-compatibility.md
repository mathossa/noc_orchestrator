# Firmware compatibility and exact image resolution

Issue #57 adds the compatibility layer between canonical firmware identity (#56) and firmware policy (#43).

## Domain boundary

Compatibility answers **can this concrete hardware model run this platform/release/image?** It does not answer which compatible platform is preferred.

```text
Observed firmware
       ↓
Canonical release identity (#56)
       ↓
Compatibility + exact image resolution (#57)
       ↓
Effective firmware policy (#43)
       ↓
Compliance / recommendation (#58)
```

A device's current `DeviceModel.platform` value is not a compatibility rule and never silently suppresses a valid cross-platform target.

## Vendor-neutral evaluator

The evaluator contains no vendor branches. Do not add logic such as:

```ts
if (vendor === 'Aruba' && platform === 'AOS-8') { ... }
```

Aruba image codes such as YA/YB/WC, Cisco image families, Fortinet platform relationships, and future vendor behavior are represented as compatibility data and evaluated through the same rule engine.

## Rule subject and target

A compatibility rule belongs to exactly one hardware subject:

- `DeviceModelFamily` for inherited support; or
- concrete `DeviceModel` for refinement/restriction.

A rule always names a software platform and can optionally narrow the target to:

- firmware train;
- logical version;
- exact canonical `FirmwareRelease`;
- image code.

Rules are `ALLOW` or `DENY` and carry an explanation plus source provenance (`CATALOG` or `CONFIGURED_RULE`). Optional validity dates allow vendor guidance to be time bounded without rewriting history.

## Deterministic precedence

Evaluation is conservative and deterministic:

1. Active exact manual override for model + release.
2. Concrete-model compatibility rule.
3. Family compatibility rule.
4. Within the same hardware scope, the most target-specific rule wins.
5. If equally specific rules conflict, `DENY` wins.
6. If nothing matches, result is `UNKNOWN` — never implicit compatibility.

Cross-vendor relationships are always incompatible.

Every result contains provenance explaining the decision and whether it was inherited.

## Exact image / variant resolution

Policy can point at a logical release while compatibility resolves the exact canonical image needed by a concrete model.

For a logical target, the resolver evaluates active canonical releases that share:

- vendor;
- software platform;
- logical version;
- firmware train when the target belongs to one.

Result states:

- `RESOLVED` — exactly one compatible exact canonical release;
- `AMBIGUOUS` — multiple compatible exact releases, so review is required;
- `UNKNOWN` — candidates exist but compatibility evidence is missing;
- `INCOMPATIBLE` — no candidate is compatible.

The resolver never guesses among multiple images.

## Manual compatibility overrides

Manual overrides are exact model + canonical release decisions. They are intended for cases where the catalog/vendor mapping is incomplete or known to be wrong.

Properties:

- authenticated actor required through the API;
- reason required;
- `ALLOW` or `DENY`;
- append/version oriented;
- previous active override is deactivated rather than overwritten;
- clearing an override exposes normal rule evaluation again;
- every set/clear is written to `AuditEvent`;
- override provenance is visibly distinguishable from catalog/configured rules.

An override changes compatibility only. It does not change catalog verification, policy eligibility, or desired firmware policy.

## Observed firmware safety

Raw reported firmware is evidence and survives independently of canonical linking.

When a device reports a version:

- raw/normalized/interpreter evidence can be stored with `currentFirmwareReleaseId = null`;
- a canonical release link is accepted only if same-vendor compatibility is proven or manually overridden;
- `UNKNOWN` or `INCOMPATIBLE` canonical links are rejected with guidance to keep the raw observation unlinked;
- `DeviceModel.platform` equality is not used as a substitute for compatibility evidence.

This lets importer publication preserve what a source reported without asserting a false catalog relationship.

## Policy integration

New policy writes validate compatibility before persistence.

### Concrete model / device

Every referenced min/preferred/max logical release must resolve to exactly one compatible concrete release for the affected model. A moving-train policy must have at least one policy-eligible compatible path in the selected train.

### Family policy

All active concrete child models are previewed. The impact is grouped as:

- resolved;
- ambiguous;
- incompatible;
- unknown.

Until #61 provides the full policy impact workspace, persistence rejects a family policy when any active child is unresolved. Nothing is silently skipped.

## UI/API

Model detail pages show:

- supported platforms derived from `ALLOW` rules;
- family-inherited versus concrete-model rules;
- train/logical release/image targeting;
- source/explanation provenance;
- active manual overrides and reasons;
- authenticated set/clear override controls.

Firmware release detail pages show compatibility for all active models from the same vendor with COMPATIBLE / INCOMPATIBLE / UNKNOWN and provenance.

API surfaces:

```text
GET    /api/v1/models/:id/firmware-compatibility
PUT    /api/v1/models/:id/firmware-compatibility
DELETE /api/v1/models/:id/firmware-compatibility
GET    /api/v1/firmware-releases/:id/compatibility
```

## Deliberate boundaries

#57 does not calculate final compliance/recommendation (#58), model upgrade dependency graphs/intermediate releases (#63), exceptions, planning, ticketing, or firmware execution.
