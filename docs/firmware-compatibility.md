# Firmware compatibility and exact image resolution

Issue #57 adds the compatibility layer between canonical firmware identity (#56) and firmware policy (#43).

## Domain boundary

Compatibility answers **can this concrete hardware model run this platform/release/image?** It does not decide which compatible platform or release is preferred.

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

A device model has one platform concept: **supported firmware platforms**. There is no separate current/default/observed platform hint on the model.

Normal model editing may express one or more supported platforms, for example:

```text
AOS-S
```

or:

```text
AOS-S, AOS-S-v2
```

The application normalizes that selection into generic compatibility evidence. The existing database `DeviceModel.platform` column is retained only as backward-compatible serialized storage while #57 is introduced; it is not a second domain concept.

When at least one supported platform is configured for a model, that selection is authoritative for broad model/platform compatibility among currently known platforms for the same vendor:

- selected platform → `ALLOW`;
- known same-vendor platform not selected → `DENY`;
- no supported platforms configured → no broad evidence, therefore `UNKNOWN`.

This means a model configured only for `AOS-S` does not silently become compatible with a newly introduced `AOS-S-v2` platform.

## Vendor-neutral evaluator

The evaluator contains no vendor branches. Do not add logic such as:

```ts
if (vendor === 'Aruba' && platform === 'AOS-8') { ... }
```

Aruba image codes such as YA/YB/WC, Cisco image families, Fortinet platform relationships, and future vendor behavior are represented as compatibility data and evaluated through the same generic engine.

## Rule subject and target

Compatibility evidence belongs to exactly one hardware subject:

- `DeviceModelFamily` for inherited support; or
- concrete `DeviceModel` for refinement/restriction.

A rule always names a software platform and can optionally narrow the target to:

- firmware train;
- logical version;
- exact canonical `FirmwareRelease`;
- image code.

Rules are `ALLOW` or `DENY` and carry explanation/source provenance. Normal supported-platform editing generates broad configured rules automatically; engineers do not need a separate rule-building workflow simply to make a model support multiple platforms.

For example:

```text
Model A supported platforms
  AOS-S

Generated broad evidence
  ALLOW AOS-S
  DENY  AOS-S-v2

Model B supported platforms
  AOS-S, AOS-S-v2

Generated broad evidence
  ALLOW AOS-S
  ALLOW AOS-S-v2
```

No vendor-specific condition is needed.

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

For a logical target, the resolver evaluates active canonical releases that share vendor, software platform, logical version, and firmware train when applicable.

Result states:

- `RESOLVED` — exactly one compatible exact canonical release;
- `AMBIGUOUS` — multiple compatible exact releases, so review is required;
- `UNKNOWN` — candidates exist but compatibility evidence is incomplete;
- `INCOMPATIBLE` — no candidate is compatible.

The resolver never guesses among multiple images.

## Manual exact-release overrides

Manual overrides are exceptional exact model + canonical release decisions for cases where normal compatibility evidence is incomplete or known to be wrong.

Properties:

- no sign-in requirement while NOC Orchestrator has no active login workflow;
- actor identity is recorded when an authenticated session is available, otherwise it may be null;
- reason required;
- `ALLOW` or `DENY`;
- append/version oriented;
- previous active override is deactivated rather than overwritten;
- clearing an override exposes normal rule evaluation again;
- every set/clear is written to `AuditEvent`;
- override provenance is visibly distinguishishable from normal evidence.

An override changes compatibility only. It does not change catalog verification, policy eligibility, or desired firmware policy.

## Observed firmware safety

Raw reported firmware is evidence and survives independently of canonical linking.

When a device reports a version:

- raw/normalized/interpreter evidence can be stored with `currentFirmwareReleaseId = null`;
- a canonical release link is accepted only if same-vendor compatibility is proven or manually overridden;
- `UNKNOWN` or `INCOMPATIBLE` canonical links are rejected with guidance to keep the raw observation unlinked.

This lets importer publication preserve what a source reported without asserting a false catalog relationship.

## Policy integration

Desired firmware and compatibility remain separate axes.

A policy expresses **intent**. Compatibility evidence answers whether that intent is currently proven safe for the targeted hardware.

For a model/device/family policy:

- `INCOMPATIBLE` is a hard block;
- `UNKNOWN` or `AMBIGUOUS` does not prevent recording desired policy intent;
- unresolved compatibility is returned as review-required context for #58/#61;
- policy eligibility, catalog state, same-vendor constraints, and declared desired platform still apply independently.

This avoids the circular workflow where an engineer cannot record the desired target merely because compatibility data has not yet been completed.

For family policies, all active concrete children are previewed and grouped as resolved, ambiguous, incompatible, or unknown. Explicitly incompatible children block application; unknown/ambiguous children remain visible for review rather than being silently skipped.

## UI behavior

Normal model editing owns supported firmware platforms. There is no second compatibility module required to configure ordinary multi-platform hardware.

Model detail pages:

- show supported platforms;
- hide explicitly incompatible releases from the desired-firmware selector;
- show compatible releases normally;
- show `UNKNOWN` choices explicitly as compatibility unknown/review-required while still allowing policy intent to be saved;
- keep the full same-vendor firmware catalog as reference rather than presenting it as a list of valid desired candidates;
- keep provenance and exceptional exact-release overrides in a collapsed advanced section.

Firmware release detail pages use the compatibility evaluator as the authoritative model applicability view. They show each same-vendor active model as `COMPATIBLE`, `INCOMPATIBLE`, or `UNKNOWN`.

## Deliberate boundaries

#57 does not calculate final compliance/recommendation (#58), model upgrade dependency graphs/intermediate releases (#63), exceptions, planning, ticketing, or firmware execution.
