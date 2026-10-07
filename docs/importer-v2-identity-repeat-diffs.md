# Importer v2 stable identity and repeat-import diffs

Issue #47 adds the durable identity and repeat-import comparison foundation without publishing canonical inventory. Evaluation remains read-only.

## Identity boundary

Only three durable signals may identify a device:

1. provider-scoped source-system device ID;
2. serial number;
3. MAC address.

Hostname and device name are context only and can never create a durable match. Customer, site, vendor, model, device type, family, and platform are compatibility/reviewer context. For a first observation from a new provider, a **unique canonical serial** may become High confidence when vendor and model also agree; the context reinforces the serial but never substitutes for it.

Source IDs are Unicode-normalized and trimmed without case folding because they are opaque identifiers in **provider-local namespaces**. AUVIK:123 and ARUBA:123 are unrelated. A same-provider confirmed Source ID is the strongest path and is automatic. A source adapter is provenance only, so an identity learned from Auvik XLSX can still be reused by the Auvik API.

Serial numbers are normalized case-insensitively. MAC addresses are reduced to a validated 12-hex-digit representation. Serial/MAC candidate discovery is shared across providers:

- same-provider confirmed Source ID → High / automatic;
- same-provider confirmed serial or MAC alias → existing confirmed-crosswalk behavior;
- new-provider serial + MAC agreeing on one canonical device → High / automatic;
- unique canonical serial + compatible vendor/model → High / automatic;
- serial and MAC pointing to different canonical devices → Ambiguous / review;
- a serial reused by multiple canonical devices → Ambiguous / review;
- hostname/name alone → no identity candidate.

Cross-provider candidates deliberately expose their provider Source IDs as provenance but never compare those Source IDs as identity signals.

## Ignored and conflicting evidence

The crosswalk separates **effective aliases** from **raw provider observations**. Effective sourceId / serialNumber / macAddress fields are the only values allowed into matching, repeat resolution, conflict checks, and confidence scoring.

Raw observations are retained beside the crosswalk with an evidence state. An explicitly suppressed IGNORE_FIELD or CLEAR_FIELD value is retained as raw evidence with state IGNORED, while its effective alias is null. This means the AP01 Auvik serial regression is auditable without allowing the bad Auvik serial to participate in a later Aruba match.

When a first observation from another provider conflicts with retained effective durable evidence, identity remains reviewable. The importer does not implement a blanket provider precedence such as Aruba-over-Auvik; trust is field/evidence based.

## Batched candidate discovery

Staging builds one shared resolver for the whole batch:

- provider-local Source IDs are fetched only inside the incoming provider namespace;
- serial and MAC aliases are fetched across all providers;
- canonical serial-bearing devices are preloaded once only when the batch contains serial evidence;
- candidate device crosswalks are then loaded in one set query for provenance/conflict inspection.

There is no per-row database scan and no query-per-identifier loop. Once a new provider has been published against a canonical device, the next sync uses that provider's Source ID directly instead of repeating cross-provider discovery.


## Repeat imports

Repeat comparison is against the latest successfully published snapshot for the same provider and source adapter. Workbook filenames are not part of identity. Snapshots stay adapter-scoped because completeness/full-inventory semantics can differ between adapters even when identity does not.

Rows are classified as New, Changed, Unchanged, Moved, Renamed, Missing, or Ambiguous. A move or rename keeps the same canonical device when durable identity agrees. Multiple change kinds are retained even when one primary classification is shown.

Changed source data produces proposals only. A proposal may update a canonical field when the current canonical value is blank or still equals the previous value supplied by this source. A different canonical value is treated as manually maintained and protected. Observed current-firmware fields may be refreshed from the newest confirmed import, but desired firmware policy, lifecycle decisions, maintenance planning, and audit history are outside the import field set and cannot be changed by this engine.

Missing devices are never deleted. Inactivity is proposed only when the import is explicitly a full-inventory export, and that proposal requires confirmation. If an ambiguous current row shares durable identity evidence with a missing previous row, the inactivity proposal is suppressed as unsafe. Snapshot-only rows that have no confirmed canonical device cannot generate an inactivity proposal.

## Persistence boundary

`recordSuccessfulImporterV2Publication` is the only Issue #47 write boundary. In one transaction it stores:

- the successful source snapshot and its rows;
- confirmed provider/source-to-canonical-device crosswalks.

It does not create, update, deactivate, or delete canonical devices. Canonical publication remains Issue #51.

The Prisma schema is now loaded as a schema directory so importer-specific persistence models can stay in a small domain file while the existing core schema remains unchanged.
