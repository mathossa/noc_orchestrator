# Firmware release catalog

Issue #7 introduces the catalog of firmware releases known to NOC Orchestrator.

## Core rule

A catalog release is **not** automatically desired firmware.

The catalog answers “which releases do we know about?” Desired state is selected explicitly by firmware policy in Issue #9 and resolved separately later. No version ordering or “latest wins” behavior is implemented here.

## Release identity

A release is identified by:

- vendor
- platform / firmware family
- opaque vendor version string

Platform/family is whitespace-normalized and compared case-insensitively for duplicate prevention. The version is trimmed but otherwise treated as opaque text; NOC Orchestrator does not assume semantic versioning.

## Catalog fields

A release supports:

- vendor
- platform/family
- version
- filename
- SHA256
- file size in bytes
- release notes URL
- release date
- notes
- catalog status
- archive state
- provenance (`MANUAL`, `API`, `IMPORT`)
- optional external provider / external ID
- synchronization timestamp/metadata reserved by the schema

Supported v0.1 catalog statuses:

- `AVAILABLE`
- `TESTING`
- `APPROVED`
- `RECOMMENDED`
- `DEPRECATED`
- `BLOCKED`

Catalog status is separate from archive state. For example, a release can be active and `BLOCKED`, or archived while retaining its historical status.

## Model applicability

For v0.1, model applicability is derived from matching:

1. vendor
2. platform/family

Device model detail pages therefore surface catalog releases sharing the model's vendor and platform. This is informational only and does not choose desired firmware.

## Deletion and history

Archiving is the safe normal removal path.

Permanent deletion is blocked when a release is referenced by:

- a device as recorded current firmware
- a firmware policy
- a lifecycle decision
- an audit record

This prevents catalog cleanup from invalidating firmware lifecycle history.
