# XLSX device inventory import

Issue #38 adds a guided spreadsheet import for recorded device inventory. It is an inventory/state input path, not a discovery mechanism and not a firmware-policy import.

## Scope

The first spreadsheet format is `.xlsx`.

The importer is deliberately not tied to one customer workbook layout. Engineers select the worksheet/header and explicitly map source columns to NOC Orchestrator fields.

Supported destination fields are:

- Customer
- Site / location
- Device name
- Hostname
- Serial number
- Vendor
- Concrete device model
- Device type
- Management address
- Current firmware
- Contract context
- External provider
- External/source ID
- Notes

Customer, Site and external provider can also be supplied as file-level defaults.

## Three-stage workflow

### 1. Inspect

`POST /api/v1/device-import/xlsx/inspect`

The original workbook is parsed without writing to the database. The response includes:

- worksheet names;
- row/column counts;
- a bounded sample of each worksheet;
- a suggested header row;
- suggested mappings for common English and Dutch inventory headings;
- Customer/Site choices for file-level defaults.

The browser retains the original `File`; no temporary import file is persisted by NOC Orchestrator.

### 2. Preview

`POST /api/v1/device-import/xlsx/preview`

The browser resends the original workbook with the selected worksheet, header row, column mapping and defaults.

Every non-empty data row is resolved against current NOC Orchestrator reference data and classified as:

- `CREATE`
- `UPDATE`
- `UNCHANGED`
- `CONFLICT`
- `ERROR`

Preview performs no database writes.

### 3. Commit

`POST /api/v1/device-import/xlsx/commit`

The browser resends the workbook, mapping/defaults and explicit selected spreadsheet row numbers.

The server reparses and revalidates the workbook against the current database. Selected rows must still be importable. All selected creates/updates are then executed inside one Prisma transaction.

A batch therefore does not report partial success when the transaction fails.

## Reference resolution

The importer uses the normal application relationships.

### Customer and Site

A row Customer is resolved by configured name or code. If a mapped Customer cell is absent/blank, the file-level Customer default may be used.

Site/location is resolved only inside the resolved Customer. A file-level Site default is rejected if it belongs to another Customer.

No Customer or Site is created from spreadsheet text.

### Vendor, device type and concrete model

Vendor and Device type are optional disambiguation inputs, but when mapped they must resolve to configured records.

Device model always resolves to a concrete `DeviceModel`. Family/series names introduced by Issue #30 are not inventory device models and are not used as a substitute for a concrete variant.

If the same model label is ambiguous without Vendor/Device type context, the row is an error and the engineer must add/map enough context.

No Vendor, Device type, model or family is created by import.

### Current firmware

A mapped current-firmware value must resolve to an existing catalog release with:

- the same Vendor as the concrete model; and
- matching concrete `DeviceModel.platform` when the model defines one.

Unknown firmware text is surfaced as an error; the importer does not silently add FirmwareRelease records.

### Contract context

Device does not own a contract field. Effective contract remains:

`Site override -> Customer default -> none`

A mapped Contract column is therefore validation-only in this version. If supplied, it must match the effective contract for the resolved Customer/Site. XLSX device import never edits Customer/Site contract assignments.

## Existing-device matching

Matching is deterministic and intentionally conservative.

1. If both external provider and external ID are available, that pair is the strongest identity.
2. Otherwise, after Customer resolution, the importer checks customer-scoped normalized device name and hostname.
3. Multiple possible matches are a conflict.
4. Multiple spreadsheet rows targeting the same existing device are conflicts.
5. Multiple create rows producing the same customer-scoped device name are conflicts.
6. Duplicate external provider + external ID values inside the selected workbook rows are conflicts.

A clear match is previewed as `UPDATE`, not silently created as a duplicate.

## Update semantics

Spreadsheet cells that are not mapped (or mapped optional cells that are blank) do not automatically clear existing optional inventory values. This makes customer exports usable when they omit fields that NOC Orchestrator already knows.

An existing row with no material inventory difference is `UNCHANGED` and is skipped.

When a current-firmware value is explicitly mapped, its observation timestamp is the import time and its source is `IMPORT`.

## Provenance and ownership boundaries

Created/updated inventory records use:

- `Device.source = IMPORT`
- `lastSynchronizedAt = import time`
- `currentFirmwareSource = IMPORT` when current firmware is supplied by the workbook

Import can update the normal device inventory/current-state fields only.

It does **not** import or overwrite:

- desired firmware policies;
- FirmwareLifecycleRecord state;
- PLANNED / IGNORED / CUSTOMER_DECLINED / DONE decisions;
- planning dates/reasons;
- existing audit history.

When imported current firmware is written, the normal current-firmware audit action is appended with XLSX file/sheet/row context.

## XLSX safety limits

The server uses a bounded OOXML reader for values needed by inventory import rather than executing spreadsheet macros or embedded content.

Current limits:

- maximum uploaded `.xlsx`: 8 MB;
- maximum worksheets: 20;
- maximum worksheet row coordinate: 5,000;
- maximum columns: 100;
- maximum total uncompressed ZIP content: 40 MB;
- worksheet sample returned to the mapping UI: first 30 non-empty rows.

Encrypted workbooks and unsupported ZIP compression methods are rejected. ZIP entry paths are normalized/validated before extraction.

Only ordinary cached cell values, shared strings and inline strings are needed for this import. Embedded scripts/macros, external links, formulas as executable logic, drawings and other workbook features are not executed.

## UX

The import workspace lives at:

`/devices/import`

The Devices page links to it as a separate inventory-input workflow so XLSX cleanup/mapping does not crowd the normal device inventory table.

The preview supports:

- automatic header/mapping suggestions;
- manual worksheet/header selection;
- manual column mapping;
- Customer/Site defaults;
- per-row action/error/change detail;
- filtering by action;
- selecting all valid rows or a subset;
- final created/updated/skipped/failed totals.

## Explicit non-goals

Issue #38 does not add:

- CSV import;
- API synchronization providers;
- live device discovery;
- SSH/SNMP interrogation;
- automatic creation of arbitrary reference data;
- desired firmware import;
- lifecycle/planning import;
- firmware execution.
