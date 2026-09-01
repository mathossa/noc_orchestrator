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
4. **Resolve entities** — work through Customers, Sites, Vendors, Device Types, Models, Firmware and Contract values. Repeated source values are collapsed into one task.
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
- Vendor + Device Type -> concrete Device Model;
- Device Model/platform -> Firmware Release.

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
- Contract Type;
- Firmware Release.

Device Model creation preserves the exact external model notation by default. Vendor prefixes are not silently stripped.

## Conservative suggestions

The staging layer can suggest likely matches for punctuation/notation differences. Suggestions are never automatically accepted.

Examples include variants such as:

`Fortinet FortiGate-100F`

and an existing label using spaces/punctuation differently.

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

Firmware still has to resolve to a release compatible with the resolved Model Vendor/platform.

## Column mapping

Supported destination fields include:

- Organization + Site;
- Customer;
- Site/location;
- Device name;
- Hostname;
- Serial number;
- Vendor;
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

The staging migration adds the persistent quarantine tables without changing normal inventory ownership.

## Non-goals

Issue #38 does not add CSV synchronization, live provider polling, live discovery/interrogation, unattended canonical reference creation, desired-firmware import, lifecycle/planning import, or firmware execution.
