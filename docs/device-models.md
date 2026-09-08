# Device model management

A device model connects inventory to vendor, device type, explicit model family/series membership, firmware compatibility, and desired-state policy.

## Identity

A device model belongs to exactly one vendor and one device type.

Model identity is vendor-scoped:

- `Cisco / C9300-24P` and `Another Vendor / C9300-24P` may coexist.
- Two case/whitespace variants of `C9300-24P` under the same vendor are rejected.
- The entered model label is preserved for display.
- A PostgreSQL expression index additionally enforces case-insensitive, whitespace-normalized uniqueness within a vendor.

This avoids assuming that model names are globally unique or follow one vendor naming convention.

## Model fields

The normal model workflow exposes:

- vendor
- device type
- optional explicit family / series
- model name
- optional **supported firmware platforms**
- optional notes
- active/archive state
- source/provenance (`MANUAL`, `API`, `IMPORT`)
- optional external provider and external ID
- synchronization timestamp when integrations populate it

Manual models require no external provider or external ID.

### Supported firmware platforms

A model has one model-level platform concept: **supported firmware platforms**. There is no separate platform hint, default platform, or observed-platform field in product semantics.

One or more platforms can be selected in the normal model editor, for example:

```text
AOS-S
```

or:

```text
AOS-S, AOS-S-v2
```

A non-empty selection is authoritative broad compatibility for the concrete model:

- selected same-vendor platforms are allowed;
- unselected same-vendor platforms are incompatible, including platforms added to the firmware catalog later;
- an empty selection means broad compatibility has not been established and therefore remains `UNKNOWN` unless other compatibility evidence resolves it.

The legacy Prisma `DeviceModel.platform` column is temporarily retained only as serialized storage for this supported-platform selection. Application behavior must not expose or interpret it as a second platform concept.

Model-family compatibility can provide inherited evidence. A concrete model's explicit supported-platform selection takes precedence and prevents family evidence from silently broadening that model to an unselected platform. More-specific compatibility evidence and deliberate exact-release overrides can refine an otherwise broad decision.

See `docs/firmware-compatibility.md` for the evaluator, precedence, image resolution, and override semantics.

## List behavior

`/models` supports:

- search, including supported platform values;
- vendor, device-type, and family filters;
- grouping by family, vendor, or device type;
- create/edit/archive/reactivate/delete actions;
- multi-select desired-firmware actions.

The model table displays **Supported platforms**, not a separate platform hint.

Archived models remain visible so historical inventory and lifecycle references do not disappear.

## Model detail

`/models/[id]` is firmware-lifecycle focused and shows:

- vendor and device type;
- family / series;
- explicit supported platforms;
- devices and customers using the model;
- effective desired firmware policy;
- recorded current firmware distribution;
- workflow-state distribution;
- the same-vendor firmware catalog with explicit compatibility status;
- provenance/synchronization context.

Desired firmware and compatibility are separate concerns. Desired firmware records policy intent; compatibility answers whether the hardware can run the target.

Known `INCOMPATIBLE` releases are not offered as normal desired choices and are rejected by persistence. `UNKNOWN` or `AMBIGUOUS` compatibility may still be recorded as policy intent, but remains review-required. Catalog safety and policy eligibility remain independent requirements.

The full same-vendor firmware catalog remains visible for reference and must not be presented as if every release were a valid desired target.

Advanced compatibility provenance and exceptional exact-release overrides are available on model detail, but ordinary supported-platform editing remains in the normal model workflow rather than requiring a second compatibility-rule editor.

No generic monitoring/health data is introduced.

## Deletion

Permanent deletion is blocked when the model is referenced by devices, firmware policies, or model audit events. Archiving is the normal safe action for historical models.
