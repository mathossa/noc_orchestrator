# Cross-dimensional device filtering and grouping

`GET /api/v1/devices` is the backend query surface for inventory filtering, grouping, sorting and pagination. The `/devices` UI stores the same query state in the URL, so a filtered/grouped view can be bookmarked or shared.

## Supported filters

Query parameters:

- `q` — free-text search across device identity and the displayed lifecycle dimensions.
- `customer` — customer ID.
- `site` — site ID; `none` means devices without a site.
- `vendor` — vendor ID.
- `model` — concrete device-model ID.
- `deviceType` — device-type ID.
- `contract` — **effective** contract ID; `none` means no effective contract.
- `currentFirmware` — exact FirmwareRelease ID; `none` means current firmware is unknown.
- `desiredFirmware` — exact resolved FirmwareRelease ID; `none` means no desired policy.
- `technicalState` — `CURRENT`, `ACTION_REQUIRED`, `UNKNOWN`, or `NO_POLICY`.
- `workflow` — `PLANNED`, `IGNORED`, `CUSTOMER_DECLINED`, `DONE`, or `UNDECIDED`.
- `source` — `MANUAL`, `API`, or `IMPORT`.
- `archive` — `active` (default), `archived`, or `all`.

All supplied filters are AND-composed. `IGNORED` and `CUSTOMER_DECLINED` are ordinary queryable workflow states; filtering never hides them merely because an operational decision exists.

## Effective contract semantics

Contract filtering uses the same runtime contract resolution as device detail:

1. site contract override, when present;
2. otherwise customer default contract;
3. otherwise no contract.

No effective-contract value is copied onto the Device table. A device at a site with an override therefore matches the site contract and does **not** also match the customer's default contract.

## Desired and technical firmware state

The query service loads inventory records and their normal relations without per-device follow-up calls, then batch-loads active model-baseline desired policies for all encountered model IDs in one policy query.

Technical state is calculated centrally with the Issue #10 resolver:

- exact current release == exact desired release → `CURRENT`
- both exist but differ → `ACTION_REQUIRED`
- desired exists but current is missing → `UNKNOWN`
- no desired policy → `NO_POLICY`

Because desired/technical state are derived dimensions, those filters are applied after the batched model-policy resolution and **before** pagination. Pagination can therefore never report a page total that ignores a desired/technical filter.

## Grouping

`groupBy` supports:

- `none` (default)
- `customer`
- `site`
- `deviceType`
- `model`

The API returns group counts for the complete filtered result, not only the current page. The paginated records carry the resolved group key/label so the UI can render sections without recomputing business semantics.

## Pagination and sorting

- `page` defaults to 1.
- `pageSize` accepts 25, 50, or 100; default 50.
- `sort` supports customer, site, vendor, model, device type, device name, current firmware text, desired firmware text, technical state, workflow, and source.
- `direction` is `asc` (default) or `desc`.

Sorting is deterministic: the selected field is followed by stable customer/name/ID tie-breakers. Firmware strings are only text-sorted for presentation; sorting does **not** infer firmware age or version precedence.

## Query validation

Unsupported enums, grouping modes, sort fields, page sizes, and malformed pagination values return HTTP 400 with field-level query validation details rather than silently changing meaning.

## Existing indexes used by the query path

The current schema already has the indexes needed by the dimensions introduced here, so Issue #13 does not add a redundant migration merely to duplicate them. Relevant indexes include:

- Device: customer, site, device model, current firmware, current-firmware source, inventory source, active state, hostname and customer/serial.
- DeviceModel: vendor, device type, platform, source and active state.
- Customer and Site: contract type; Site also indexes customer.
- FirmwareLifecycleRecord: workflow state, target, planned/review dates.
- FirmwarePolicy: model + active state plus the partial unique active model-baseline index introduced by Issue #9.

This avoids an obvious N+1 pattern: related inventory is loaded through the existing relation include, desired policy is resolved in one batched query, and grouping/filtering is performed on the backend result before the response is paginated.

## Examples

Action-required Cisco switches for one customer, grouped by model:

```text
/api/v1/devices?customer=<id>&vendor=<id>&deviceType=<id>&technicalState=ACTION_REQUIRED&groupBy=model
```

Devices whose customer declined the change, using an effective contract and a specific desired release:

```text
/api/v1/devices?contract=<id>&desiredFirmware=<release-id>&workflow=CUSTOMER_DECLINED
```

Unassigned devices with no desired policy:

```text
/api/v1/devices?site=none&desiredFirmware=none
```
