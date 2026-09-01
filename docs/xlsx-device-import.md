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

The original workbook is parsed without writing device inventory. The response includes worksheet/header samples, suggested mappings, Customer/Site defaults, and configured Vendor/Device Type/Device Model/family choices used by the resolution UI.

The browser retains the original `File`; no temporary import file is persisted by NOC Orchestrator.

### 2. Preview and resolve

`POST /api/v1/device-import/xlsx/preview`

The browser resends the original workbook with the selected worksheet, header row, column mapping, defaults, and any one-time reference resolutions.

Every non-empty data row is resolved against current NOC Orchestrator reference data and classified as:

- `CREATE`
- `UPDATE`
- `UNCHANGED`
- `CONFLICT`
- `ERROR`

Unknown Device Type and concrete Device Model values are grouped by raw spreadsheet value. Instead of editing every row, an engineer can choose one of three deliberate actions:

1. **Use once** — map the spreadsheet value to an existing configured record for this import only.
2. **Always match** — persist the mapping as an import alias so future XLSX imports automatically make the same match.
3. **Create new** — explicitly create the missing Device Type or concrete Device Model from inside the import workspace, then use it once or remember the match.

Preview itself does not write device inventory. Explicitly creating reference data or choosing **Always match** is a separate deliberate configuration write initiated by the engineer.

After resolutions are selected, the preview is run again before any device rows can be imported.

### 3. Commit

`POST /api/v1/device-import/xlsx/commit`

The browser resends the workbook, mapping/defaults/resolutions and explicit selected spreadsheet row numbers.

The server reparses and revalidates the workbook against the current database. Selected rows must still be importable. All selected creates/updates are then executed inside one Prisma transaction.

A batch therefore does not report partial success when the transaction fails.

## Reference resolution

The importer uses the normal application relationships.

### Customer and Site

A row Customer is resolved by configured name or code. If a mapped Customer cell is absent/blank, the file-level Customer default may be used.

Site/location is resolved only inside the resolved Customer. A file-level Site default is rejected if it belongs to another Customer.

Customer and Site creation is not part of the inline resolver in this version.

### Vendor

Vendor remains a configured reference and must resolve by configured name/code when mapped. Inline Vendor creation is not included in this iteration.

### Device type

A spreadsheet type such as `Switch`, `Firewall`, or `Access Point` can be linked to an existing configured type even when its spelling/name does not match exactly (for example `Switch` -> `Switches`).

One-time mappings live only in the current import options. **Always match** stores a normalized `ImportReferenceAlias` so later imports reuse the decision.

If the correct Device Type does not yet exist, it can be explicitly created from the resolution panel using the normal reference-data validation rules.

### Concrete device model

Device inventory always resolves to a concrete `DeviceModel`. Family/series names introduced by Issue #30 are organizational context and are not used as inventory model substitutes.

Raw model notation is preserved. For example, a workbook value such as `Fortinet FortiGate-100F` is not silently shortened to `FortiGate-100F`. The engineer can:

- map that exact spreadsheet notation to an existing concrete model;
- remember that mapping for later imports; or
- create a new concrete model with the raw notation prefilled and edit it before saving.

Saved model aliases are vendor-scoped. This prevents the same raw model value from being accidentally mapped across vendors. A model created from the import still requires an explicit Vendor and Device Type and may optionally be placed in an existing model family/series and given a concrete firmware platform.

### Persistent import aliases

Persistent aliases are stored separately from the actual Vendor/Device Type/Device Model records. They do not rename or duplicate the target record.

The current alias kinds are:

- `DEVICE_TYPE`
- `DEVICE_MODEL`

Device Type aliases are global. Device Model aliases are scoped to the target Vendor. Updating an existing alias is an explicit **Always match** action.

### Current firmware

A mapped current-firmware value must resolve to an existing catalog release with the same Vendor as the concrete model and a matching concrete `DeviceModel.platform` when the model defines one.

Unknown firmware text is still surfaced as an error; inline FirmwareRelease creation is not part of this issue.

### Contract context

Device does not own a contract field. Effective contract remains:

`Site override -> Customer default -> none`

A mapped Contract column is validation-only. If supplied, it must match the effective contract for the resolved Customer/Site. XLSX device import never edits Customer/Site contract assignments.

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

Concrete Device Models deliberately created from the import resolver use `DeviceModel.source = IMPORT`.

Import can update the normal device inventory/current-state fields only. It does **not** import or overwrite desired firmware policies, lifecycle workflow decisions, planning data, or existing audit history.

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

The import workspace lives at `/devices/import`.

The Devices page links to it as a separate inventory-input workflow so XLSX cleanup/mapping does not crowd the normal device inventory table.

The preview supports automatic header/mapping suggestions, manual mapping/defaults, grouped unresolved reference decisions, one-time or persistent aliases, inline Device Type/Device Model creation, per-row action/error/change detail, action filtering, subset selection, and final created/updated/skipped/failed totals.

## Explicit non-goals

Issue #38 still does not add CSV import, API synchronization providers, live discovery, SSH/SNMP interrogation, automatic/unattended creation of reference data, inline Customer/Site/Vendor/Firmware creation, desired firmware import, lifecycle/planning import, or firmware execution.
