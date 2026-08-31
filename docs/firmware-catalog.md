# Firmware release catalog

Issue #7 introduces the catalog of firmware releases known to NOC Orchestrator.

## Core rule

A catalog release is **not** automatically desired firmware.

The catalog answers “which releases do we know about?” Desired state is selected explicitly by firmware policy in Issue #9 and resolved separately later. No version ordering or “latest wins” behavior is implemented here.

## Release trains / families

Firmware trains are explicit catalog records used to group exact releases into a vendor release family, for example:

```text
FortiOS / 8.13.x
├── 8.13.0
├── 8.13.1
├── 8.13.2
└── 8.13.3
```

or:

```text
IOS XE / 17.15.x
├── 17.15.1
├── 17.15.3
└── 17.15.5
```

These examples are only labels. NOC Orchestrator does **not** parse a release version to infer its train. Engineers or future integrations explicitly create the train and assign releases to it.

A train belongs to one vendor and one platform/family. A release may belong to zero or one train. If assigned, the train must have the same vendor and normalized platform/family as the release.

Train identity is vendor + normalized platform/family + normalized train name. Trains can be archived without detaching their historical releases. Permanent deletion is blocked while releases or audit history reference the train.

Issue #9 will target an **exact release** by default, not “latest release in train.” A future policy mode may deliberately support something like “latest APPROVED in 8.13.x,” but adding a new catalog release must never silently change desired state.

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
- optional release train
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

A train supports:

- vendor
- platform/family
- train name
- notes
- archive state
- provenance (`MANUAL`, `API`, `IMPORT`)
- optional external provider / external ID
- synchronization timestamp/metadata reserved by the schema

Supported v0.1 catalog statuses for individual releases:

- `AVAILABLE`
- `TESTING`
- `APPROVED`
- `RECOMMENDED`
- `DEPRECATED`
- `BLOCKED`

Catalog status is separate from archive state. For example, a release can be active and `BLOCKED`, or archived while retaining its historical status.

## UI routes

- `/firmware` manages exact releases and lets a release select an optional matching train.
- `/firmware/[id]` shows release metadata, usage, matching models, and train membership.
- `/firmware/trains` manages release trains.
- `/firmware/trains/[id]` shows all exact releases assigned to one train.

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

Permanent train deletion is blocked while releases or train audit history reference it.

This prevents catalog cleanup from invalidating firmware lifecycle history.
