# Firmware policy foundation

Issue #43 replaces the original exact-model-only desired firmware mechanism with the policy foundation used by later compatibility, compliance, planning, and reporting work.

## Ownership boundary

Keep four concepts separate:

```text
Observed firmware        what inventory reports now
Firmware catalog         releases/builds/images that exist
Firmware policy          what a scope is allowed/preferred to run
Compliance/planning      what action follows from observed + policy + compatibility
```

Inventory/import is never authoritative for desired state. A newly observed or verified release does not become allowed, preferred, or desired merely because it exists.

## Normal baseline: model family

`DeviceModelFamily` is the normal reusable firmware-policy baseline. Concrete models remain the inventory identity and may refine the family policy only when needed.

```text
Aruba AP500 family
└── policy baseline

AP-505
AP-515
AP-535
└── inherit family policy unless a concrete-model policy overrides it
```

Do not duplicate the family baseline onto every child model.

Existing Issue #9/#30 `DeviceModel -> exact FirmwareRelease` rows are retained and interpreted as concrete-model `EXACT` policy versions.

## Tracks

A hardware family/model may have multiple policy paths at the same time.

```text
AP500
├── Preferred
│   └── AOS-10
└── Accepted legacy
    └── AOS-8
```

Initial track classifications:

- `PREFERRED`
- `ACCEPTED`
- `LEGACY`
- `RESTRICTED`

A track has a stable `trackKey`, a human-readable name/classification, a desired software platform, and one policy definition. Multiple tracks may coexist, but one applicable track normally needs to be marked the default. The resolver returns an explicit unresolved result instead of guessing when defaults are missing or ambiguous.

The currently running platform is not used to choose a desired track. An AOS-8 device can therefore legitimately resolve an AOS-10 desired policy.

## Scope precedence

The central resolver uses the documented precedence:

```text
Device
  > Site
  > Customer
  > concrete DeviceModel
  > DeviceModelFamily
```

At a Customer or Site scope, a concrete-model subject is more specific than a family subject.

The resolver returns both the selected policy and provenance, for example:

```text
Desired track: Accepted legacy
Platform:      AOS-8
Policy source: Customer -> DHL
Policy ID:     ...
Policy version: 3
Effective from: ...
```

Existing `contractTypeId`, `vendorId`, and `deviceTypeId` columns are retained for migration/history compatibility, but Issue #43 deliberately gives them no undocumented precedence over the chain above.

## Policy modes

### EXACT

One exact canonical release is the preferred/accepted target.

```text
preferred = 17.15.5
```

### MINIMUM

A minimum accepted release is stored independently from the preferred target.

```text
minimum   = 8.10.0.20
preferred = 8.13.2.0
```

### RANGE

An acceptance window and preferred target are separate.

```text
minimum   = 17.12.5  inclusive
preferred = 17.15.5
maximum   = 17.16    exclusive
```

Both bounds have explicit inclusive/exclusive flags. The policy writer uses the vendor/platform-aware comparison boundary from #56 and rejects ranges whose ordering cannot be proven instead of guessing.

### LATEST_APPROVED_IN_TRAIN

An explicit moving-target policy references a `FirmwareTrain` rather than requiring an exact preferred release row.

```text
train = 16.11
mode  = LATEST_APPROVED_IN_TRAIN
```

Only catalog releases that are explicitly policy-eligible can participate. Merely importing a newer release never moves policy intent.

Issue #43 makes this mode representable and resolvable as policy intent. Choosing the exact effective release for compliance/recommendation belongs to the later compliance resolver (#58), after compatibility (#57) can eliminate invalid model/image combinations.

## Acceptance window versus preferred target

These answer different questions:

```text
Acceptance window: is this running version allowed?
Preferred target:  what would we install when updating?
```

A device can therefore be accepted but below the preferred target. Conversely, a release numerically newer than the preferred target is not automatically accepted unless the policy window allows it.

Issue #43 persists and resolves these definitions. It does not assign final device compliance labels; that is #58.

## Effective dates and history

Policy rows are append-oriented versions.

Each version stores at least:

- scope/subject;
- track;
- mode;
- desired platform;
- minimum/preferred/maximum or train target;
- inclusive/exclusive bounds;
- effective start;
- policy version;
- active/archive state;
- notes and audit history.

Default activation is `NOW`, but a future `effectiveFrom` is supported.

```text
v1 effective Sep 1   <- current
v2 effective Oct 1   <- future / inspectable
```

Creating v2 does not delete, rewrite, or prematurely deactivate v1. The resolver selects the newest version that is effective at the requested time and can expose the next future change.

## Existing exact model API

The existing endpoint remains a compatibility shortcut:

```text
PUT /api/v1/models/[id]/desired-firmware
{ "firmwareReleaseId": "..." }
```

It appends an `EXACT` concrete-model policy in the default preferred track. Existing UI can therefore continue working while richer family/customer/site/device policy editing is introduced later in the dedicated policy workspace (#61).

Clearing the legacy concrete-model shortcut archives/deactivates that override; historical rows are retained.

## Catalog approval boundary

A new policy may reference only canonical releases that are active, not blocked/withdrawn, and explicitly `ALLOWED` or `PREFERRED` by the #56 catalog semantics.

Catalog verification and policy approval remain different concepts:

```text
VERIFIED + NOT_EVALUATED   -> exists, not a policy target
VERIFIED + ALLOWED         -> may be referenced
VERIFIED + PREFERRED       -> may be referenced
BLOCKED/WITHDRAWN          -> not a new policy target
```

## Cross-platform policy and #57 compatibility boundary

Issue #43 intentionally stops using the legacy single `DeviceModel.platform` field as a desired-policy compatibility gate. Hardware may support more than one software platform, and policy may intentionally describe a migration.

This does **not** mean every same-vendor release is actually compatible with every model.

```text
#43: policy says AP500 should move to AOS-10
                 ↓
#57: compatibility resolves whether AP-505/AP-515/... support that platform
     and which exact image/build applies
```

Until #57, model/bulk selectors may expose same-vendor policy-eligible cross-platform candidates rather than silently suppressing a legitimate migration. #57 will replace that temporary broad candidate set with concrete compatibility/image resolution.

## Resolver contract

`resolveFirmwarePolicyAt` / `resolveFirmwarePolicyTimeline` are pure and deterministic. The persistence facade can resolve candidates for a device without embedding precedence logic in UI components.

The result contains:

- resolved/unresolved status;
- effective policy definition;
- selected track;
- desired platform;
- policy mode and acceptance/preferred IDs;
- source scope and source ID;
- policy ID/version/effective date;
- unresolved reason when no safe result exists;
- next future policy change when applicable.

## Transitional exact-state views

Some existing dashboard/device/vendor views still use the old equality-only technical state (`CURRENT`, `ACTION_REQUIRED`, etc.). In Issue #43 they are made version-aware and nullable-target-safe, but they intentionally remain exact-model-target summaries.

They must not be treated as the final compliance engine. #58 will replace those calculations with the full effective-policy + compatibility resolver.

## Out of scope for #43

- parsing vendor firmware strings (#56 already owns release identity/comparison);
- model/image/platform compatibility (#57);
- device compliance/recommendation classification (#58);
- exceptions such as Customer Declined (#59);
- work planning/tickets/scheduling (#60);
- full policy workspace and impact simulation (#61);
- execution/upgrades.
