# XLSX device inventory import

Issue #38 adds a guided spreadsheet import for recorded device inventory. It is an inventory/current-state input path, not a monitoring or device-discovery mechanism and not a desired-firmware/lifecycle import.

## Import workflow

The workspace lives at `/devices/import` and uses three server-validated stages:

1. **Inspect** — parse the XLSX, select worksheet/header, inspect a sample, and choose or create an import profile.
2. **Preview / resolve** — map columns, resolve reference values, review CREATE / UPDATE / UNCHANGED / CONFLICT / ERROR rows, and choose rows to import. Preview does not write device inventory.
3. **Commit** — reparse and revalidate the original workbook against the current database, then write selected CREATE/UPDATE rows in one Prisma transaction.

The browser retains the original `File` and resends it for each stage; no temporary uploaded workbook record is required.

## Reusable import profiles

Exports from products such as Auvik normally keep the same layout between runs. `DeviceImportProfile` stores those structural choices so they do not need to be recreated on every import.

A profile stores:

- profile/export name, e.g. `AUVIK EXPORT`;
- external provider, e.g. `Auvik`;
- worksheet name;
- header row;
- column mapping;
- optional Customer/Site defaults;
- Organization/Site split delimiter.

The import page exposes saved profiles through a dropdown near the external-provider/default settings. Selecting a profile restores its mapping. Updating the profile persists later layout changes.

Reference aliases remembered with **Always match** are scoped to the selected profile. This means an Auvik-specific name does not silently become a rule for an unrelated CMDB export. Existing legacy/global aliases remain supported when no profile is selected.

## Column mapping

Supported destination fields are:

- combined Organization + Site;
- Customer;
- Site / location;
- Device name;
- Hostname;
- Serial number;
- Vendor;
- concrete Device model;
- Device type;
- Management address;
- Current firmware (generic);
- Firmware Version;
- Software Version;
- Contract context;
- External provider;
- External/source ID;
- Notes.

Scalar fields such as hostname, IP address, serial number and notes do not need a reference-link decision. Their source column is remembered by the import profile.

Reference-valued fields can be resolved explicitly when source text does not match configured NOC Orchestrator data.

## Auvik Organization Name: `<Organization> - <Site>`

Auvik-style `Organization Name` is suggested as **Organization + site (split one column)**.

The default delimiter is ` - `. The importer splits on the final occurrence. For example:

`Unica Groep - UICTS Working Spirit Deventer`

becomes:

- Customer: `Unica Groep`
- Site: `UICTS Working Spirit Deventer`

Resolution is dependency-aware:

1. Customer is resolved first.
2. Site is resolved only inside that Customer.
3. If Customer is not yet known, resolve/create the Customer and re-run preview.
4. The Site can then be linked or created under that Customer.
5. When both choices are remembered for the selected profile, future exports resolve them automatically.

A Site alias is always Customer-scoped and can never assign a Site across Customers.

## Explicit reference resolution

The preview aggregates repeated unresolved values so one decision applies to every matching row.

Reference kinds currently supported by the resolver are:

- Customer;
- Site;
- Vendor;
- Device Type;
- concrete Device Model;
- Contract Type;
- Firmware Release.

For a reference value an engineer may choose:

- **Use once** — map the raw value for the current preview/import only;
- **Always match** — save the mapping for the selected import profile;
- **Create new** — deliberately create the missing reference using the normal application validation, then use it once or remember it.

Creation is always explicit. The importer never creates arbitrary reference records unattended merely because spreadsheet text was not recognized.

Mappings that need context keep that context in their alias key:

- Site → Customer;
- Device Model → Vendor;
- Firmware Release → Vendor + platform.

Device inventory always points at a concrete `DeviceModel`; a family/series is never substituted for the concrete model.

## Firmware Version vs Software Version

Exports may contain both fields. When both are mapped:

1. **Firmware Version** is the preferred source for `Device.currentFirmwareRelease`.
2. **Software Version** is a fallback only when Firmware Version is absent/blank.

For verbose Software Version strings the importer extracts the dotted version when possible. Examples:

- `FortiGate-100F v7.4.12,build2902,...` → `7.4.12`
- `S424EF-v7.4.9-build946,260122 (GA)` → `7.4.9`
- `FP231G-v7.4.7-build0802` → `7.4.7`

The resulting version still has to resolve to a Firmware Release compatible with the concrete model's Vendor/platform. An engineer may link, remember, or explicitly create a missing Firmware Release from the resolver.

## Customer, Site and contract semantics

Site assignment is always scoped to the resolved Customer.

Device does not own a contract field. Effective contract remains:

`Site override -> Customer default -> none`

A mapped Contract column is validation context. A Contract Type may be linked/created as reference data, but device import does **not** automatically change Customer/Site contract assignment. The resolved Contract must still equal the effective contract.

## Existing-device matching

Matching is deterministic and conservative:

1. external provider + external ID when both are available;
2. otherwise Customer-scoped normalized Device name and/or hostname;
3. multiple possible matches are conflicts;
4. multiple spreadsheet rows targeting the same existing Device are conflicts;
5. multiple create rows producing the same Customer-scoped Device name are conflicts;
6. duplicate provider + external ID pairs inside the workbook are conflicts.

A clear match becomes UPDATE instead of silently creating a duplicate. Blank/unmapped optional cells do not automatically clear existing optional inventory values.

## Provenance and ownership boundaries

Created/updated Devices use `source = IMPORT` and update `lastSynchronizedAt`.

When current firmware is supplied by the workbook:

- `currentFirmwareSource = IMPORT`;
- observation time is the import time;
- the normal current-firmware audit event includes workbook sheet/row context and selected import-profile ID.

XLSX import never overwrites:

- desired firmware policies;
- lifecycle workflow state;
- PLANNED / IGNORED / CUSTOMER_DECLINED / DONE decisions;
- planning/review dates or reasons;
- existing audit history.

## XLSX safety limits

There is no artificial 5,000-row application limit anymore. Worksheets are accepted up to the XLSX/Excel row-coordinate maximum (1,048,576 rows), subject to workbook-size safeguards.

Current safeguards remain:

- maximum uploaded `.xlsx`: 8 MB;
- maximum worksheets: 20;
- maximum columns parsed per worksheet: 100;
- maximum total uncompressed ZIP content: 40 MB;
- worksheet sample returned to the mapping UI: first 30 non-empty rows.

Encrypted workbooks, unsupported compression, unsafe ZIP paths and malformed archives are rejected. Embedded scripts/macros, external links and formula code are not executed.

For very large exports, compressed/uncompressed size limits remain the controlling resource boundary instead of a fixed device-row count.

## Database additions

Issue #38 uses two migrations:

1. `ImportReferenceAlias` for the original explicit remembered mappings.
2. `DeviceImportProfile` + `DeviceImportProfileAlias` for reusable exporter layouts and profile-scoped remembered choices.

## Non-goals

Issue #38 does not add CSV import, API synchronization providers, live discovery, SSH/SNMP interrogation, unattended reference creation, desired-firmware import, lifecycle/planning import, or firmware execution.
