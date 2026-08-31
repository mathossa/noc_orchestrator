# Configurable reference data

Issue #4 turns vendors, device types, and contract types into editable NOC Orchestrator reference data.

## Why these are records

Vendors, device types, and contract types are not application enums. Operators may add categories that do not exist in the initial environment without changing application code or deploying a schema change.

The application therefore does not treat examples such as `Switch`, `Firewall`, `Access Point`, `Fully Managed`, or `Customer Managed` as universal business rules.

## Name and code rules

Reference names are cleaned before persistence using the following explicit normalization rule:

1. Unicode NFKC normalization
2. trim leading/trailing whitespace
3. collapse internal whitespace runs to one space
4. compare case-insensitively for uniqueness

The display casing supplied by the operator is retained. PostgreSQL also has normalized unique indexes so concurrent API writes cannot bypass the uniqueness rule.

Codes are canonicalized to uppercase and whitespace/underscores become hyphens. Codes accept letters, numbers, dots, and hyphens.

## Archival and deletion

`isActive=false` is the normal archival path. Archived records remain available for history and future filter semantics.

Permanent deletion is allowed only when the record is unreferenced:

- vendors are protected when referenced by device models, firmware releases, or firmware policies
- device types are protected when referenced by device models or firmware policies
- contract types are protected when referenced by customers or firmware policies

The API returns `409 REFERENCE_IN_USE` when a destructive delete would break integrity and directs the operator to archive the record instead.

## Contract firmware capability

`ContractType.firmwareManagementEnabled` indicates whether firmware management applies to that contract category.

This is intentionally a capability flag, not a rules engine. Later policy/planning work may use it, but Issue #4 does not make contract types implicitly decide desired firmware or lifecycle workflow.

## API

Collection routes:

```text
GET  /api/v1/reference-data/vendors
POST /api/v1/reference-data/vendors

GET  /api/v1/reference-data/device-types
POST /api/v1/reference-data/device-types

GET  /api/v1/reference-data/contract-types
POST /api/v1/reference-data/contract-types
```

Record routes:

```text
PATCH  /api/v1/reference-data/{kind}/{id}
DELETE /api/v1/reference-data/{kind}/{id}
```

PATCH is also used for archive/reactivate through `isActive`.

Validation failures use HTTP 400 with field-level errors where applicable. Duplicate code/name and referenced-delete conflicts use HTTP 409.
