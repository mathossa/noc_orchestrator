# XLSX device inventory import

Issue #38 implements a staged inventory-ingestion workflow. It is an inventory/current-state input path, not monitoring, discovery, desired-firmware import, lifecycle import, or firmware execution.

The central design rule is:

> External inventory is quarantined first. Resolve unique entities once, remember source-specific decisions, and publish canonical devices only after the staged batch is clean.

## Workflow

`/devices/import` is an **Import Inbox** plus upload/mapping screen.

The workflow is:

1. **Inspect** — upload the XLSX, inspect a bounded sample, choose worksheet/header and map columns.
2. **Choose/save source profile** — e.g. `AUVIK EXPORT`.
3. **Stage** — persist raw + mapped rows and unique external reference values. Nothing is globally visible yet.
4. **Resolve entities** — work through Customers, Sites, Vendors, Product Families, Software Platforms, Device Types, Models and Firmware. Repeated source values are collapsed into one task.
5. **Final device validation** — reuse the normal Device duplicate/domain validation engine.
6. **Accept and publish** — only a clean, explicitly accepted batch becomes normal inventory.

The staged workspace is persistent. Engineers can leave and continue later.

## Staging data model

Three import-only working tables quarantine source data:

- `DeviceImportBatch` — source file/profile/settings/status;
- `DeviceImportStagedRow` — raw and mapped device row data;
- `DeviceImportStagedReference` — one unique source entity/value with status, dependency metadata, suggestion and selected target.

Canonical Customer/Site/Vendor/DeviceType/DeviceModel/FirmwareRelease/Device records are not created merely because text appears in a workbook.

## Entity-first cleanup

A large workbook may contain thousands of devices but only a few dozen distinct external entities. The resolver therefore works on unique values rather than device rows.

Example summary:

- Customers: 14 total / 11 linked / 3 review
- Sites: 62 total / 43 linked / 19 review
- Vendors: 4 total / 3 linked / 1 review
- Models: 38 total / 21 linked / 17 review
- Devices: 8,421 staged rows

Resolving one Model applies to every staged row that uses the same source value and dependency context.

## Dependency-aware resolution

Child references do not become errors only because their parent is unresolved.

Dependencies include:

- Customer -> Site;
- Vendor + Product Family + Software Platform + Device Type -> concrete Device Model;
- Device Model/Software Platform -> Firmware Release and Firmware Train.

## Device classification hierarchy

The importer keeps commercial classification separate from the software stack:

`Vendor -> Product Family -> Software Platform -> Model -> Firmware Release`

Device Type remains a separate functional classification attached to the Model/device.

- **Vendor** is the manufacturer/brand, such as Fortinet, Cisco, or HPE Aruba.
- **Product Family** uses the existing `DeviceModelFamily` entity for commercial lines such as FortiGate, Catalyst, Aruba CX, and Aruba WLAN.
- **Software Platform** is an explicit catalog entity for FortiOS, IOS, IOS XE, AOS-S, AOS-CX, AOS 8, and AOS 10.
- **Device Type** describes function: Firewall, Switch, Access Point, Router, or Controller.
- **Model** is the concrete hardware identifier.
- **Firmware Release** is the installed/available software version and is linked to an inferred Firmware Train where possible.

Legacy platform strings remain during the compatibility migration, but new importer writes also link `DeviceModelPlatform`, `FirmwareTrain`, and `FirmwareRelease` to `SoftwarePlatform`.

For example, a Site can display `Waiting for Customer`. After that Customer is linked or created, staged references are refreshed and the Site becomes actionable.

Site resolution is always scoped to the resolved Customer. Cross-customer Site linking is rejected server-side.

## Resolution actions

For each unique reference value the staged workspace can:

- **Link once** — use an existing canonical entity for this batch;
- **Remember match** — use the entity and save the decision for the selected import profile;
- **Create + link** — explicitly create missing canonical reference data with a prefilled form;
- **Create + remember** — create it and remember the source mapping for future imports.

Creation is always explicit. Unknown source values are never silently promoted to canonical reference data.

The workspace supports explicit creation of:

- Customer;
- Site under its resolved Customer;
- Vendor;
- Device Type;
- concrete Device Model;
- Firmware Release.

Device Model creation preserves unrecognized external model notation by default. Deterministic, visible normalization proposals handle known product syntax, for example `FortiGate-100F` -> `FG-100F`. These proposals still require Final Review.

## Classification and reusable normalization

The staging layer can suggest likely matches for punctuation/notation differences and deterministic classifications. Suggestions are never automatically accepted.

Built-in classifications include:

- `Fortigate`, `FortiGate`, and `FG-` -> FortiGate + FortiOS + Firewall;
- `C9300-*` -> Catalyst + IOS XE + Switch;
- `WS-C2960X-*` -> Catalyst + IOS + Switch;
- `2530-*` -> Aruba Switch + AOS-S + Switch;
- `CX 6200*` -> Aruba CX + AOS-CX + Switch;
- `AP-315` -> Aruba WLAN with AOS 8/AOS 10 support;
- `AP-515` -> Aruba WLAN + AOS 10.

The worksheet presents predicted Model links and creations in a grouped selection queue. Canonical matches and high-confidence classifications are preselected; an engineer can select or defer individual predictions, a whole Product Family group, all confident predictions, or the complete queue before Final Review. Deferred predictions remain visible for a later pass.

Existing-Model predictions use strict hardware identity. Vendor, Product Family, and punctuation prefixes may differ, but `70G` is never treated as `70F`, `100F` as `101F`, or `C9300-24P` as `C9300-48P` merely because the labels look similar.

Confirmed values are stored as profile-scoped `NORMALIZE` rules, including the normalized Model, Product Family, Software Platform(s), and Device Type. Existing profile aliases continue to remember entity links such as `Aruba -> HPE Aruba` (or the selected canonical Vendor).

Weak or ambiguous similarities produce no suggestion.

## Reusable source profiles

Exports such as Auvik normally keep a stable structure and vocabulary. `DeviceImportProfile` stores:

- profile name, e.g. `AUVIK EXPORT`;
- external provider, e.g. `Auvik`;
- worksheet/header;
- column mapping;
- optional file-level Customer/Site defaults;
- Organization/Site split delimiter.

`DeviceImportProfileAlias` stores explicit remembered semantic decisions.

`DeviceImportProfileRule` stores both reusable device-row Ignore rules and confirmed Model normalization/classification results.

When a profile is selected, only that profile's aliases are used. Auvik-specific vocabulary therefore cannot leak into an unrelated CMDB export.

On the next Auvik import, previously remembered values should link automatically. The engineer only reviews new or changed vocabulary.

## Auvik Organization Name

`Organization Name` is suggested as **Organization + site (split one column)**.

With delimiter ` - `:

`Unica Groep - UICTS Working Spirit Deventer`

becomes:

- Customer: `Unica Groep`
- Site: `UICTS Working Spirit Deventer`.

Customer is resolved first. Site is then resolved inside that Customer.

## Firmware Version and Software Version

The mapper distinguishes:

- `Firmware Version` — preferred current-firmware source;
- `Software Version` — fallback when Firmware Version is absent/blank.

Verbose Software Version strings can yield an embedded dotted firmware version, for example:

- `FortiGate-100F v7.4.12,build2902,...` -> `7.4.12`
- `S424EF-v7.4.9-build946,...` -> `7.4.9`
- `FP231G-v7.4.7-build0802` -> `7.4.7`

Firmware still has to resolve to a release compatible with the resolved Model Vendor/Software Platform. Import-created observed releases remain `AVAILABLE`; they are never automatically made approved, recommended, or desired. Their Firmware Train is inferred conservatively (for example `7.4.7` -> `7.4`, `17.12.5` -> `17.12`, and `WC.16.11.0020` -> `WC.16.11`).

## Column mapping

Supported destination fields include:

- Organization + Site;
- Customer;
- Site/location;
- Device name;
- Hostname;
- Serial number;
- Vendor;
- Product Family;
- Software Platform;
- concrete Device Model;
- Device Type;
- Management address;
- Current firmware;
- Firmware Version;
- Software Version;
- Contract context;
- External provider;
- External/source ID;
- Notes.

Scalar fields such as Hostname, IP address, Serial and Notes do not need entity linking. Their column mappings are remembered by the profile.

## Final device validation

After staged references are linked, the batch is converted into a canonical validation plan using the existing Device import/domain logic.

The plan still classifies:

- CREATE;
- UPDATE;
- UNCHANGED;
- CONFLICT;
- ERROR.

Publication is blocked while any Conflict or Error remains.

Duplicate matching stays conservative:

1. external provider + external ID when available;
2. otherwise Customer-scoped normalized Device name/hostname;
3. ambiguous or duplicate destination rows are conflicts.

A clean match updates an existing Device instead of silently creating a duplicate.

## Publication boundary

Staged data is not visible in normal `/devices`, dashboards, planning or reports.

Only **Accept and publish** promotes the batch into canonical inventory.

Published Device changes use `IMPORT` provenance and the existing current-firmware audit behavior.

Import never overwrites:

- desired firmware policy;
- lifecycle workflow state;
- PLANNED / IGNORED / CUSTOMER_DECLINED / DONE decisions;
- planning/review dates/reasons;
- existing audit history.

Device contract remains derived from:

`Site override -> Customer default -> none`

A mapped Contract value is validation context only; it does not assign a contract to Device.

## Large-workbook behavior

There is no fixed 5,000-row application limit.

The XLSX reader accepts row coordinates up to Excel's worksheet maximum of 1,048,576, subject to workbook safety limits.

Browser rendering remains bounded:

- inspection materializes only the first 30 non-empty rows per sheet;
- the staged Devices tab returns only a small row sample;
- final validation returns bounded row detail while full counts cover the batch;
- unique reference values, not thousands of repeated row errors, drive cleanup.

Ignore, Exclude, and Restore recalculate only references touched by the changed device rows. Normal row/group actions do not delete and reconstruct the complete staged reference set.

Current workbook safeguards include:

- maximum uploaded XLSX: 8 MB;
- maximum worksheets: 20;
- maximum parsed columns per worksheet: 100;
- maximum expanded ZIP content: 40 MB;
- encrypted/malformed/unsafe archives rejected.

No workbook code/macros are executed.

## Migrations

Issue #38 currently adds:

1. `20260901143000_import_reference_aliases`
2. `20260901152000_device_import_profiles`
3. `20260901163000_device_import_profile_schema_alignment`
4. `20260901185500_device_import_staging`
5. `20260902023000_import_automation_multiplatform`
6. `20260902213000_product_family_software_platform_import_rules`

The staging migration adds the persistent quarantine tables without changing normal inventory ownership.

## Non-goals

Issue #38 does not add CSV synchronization, live provider polling, live discovery/interrogation, unattended canonical reference creation, desired-firmware import, lifecycle/planning import, or firmware execution.
