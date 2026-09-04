# Importer v2 stable identity and repeat-import diffs

Issue #47 adds the durable identity and repeat-import comparison foundation without publishing canonical inventory. Evaluation remains read-only.

## Identity boundary

Only three signals contribute to device identity confidence:

1. provider-scoped source-system device ID;
2. serial number;
3. MAC address.

Hostname, device name, management address, customer, business unit, site, vendor, model, family, platform, and stack/member context may be shown as reviewer evidence, but they never change the confidence score.

Source IDs are Unicode-normalized and trimmed without case folding because they are opaque provider identifiers. Serial numbers are normalized case-insensitively. MAC addresses are reduced to a validated 12-hex-digit representation.

A provider/source-ID match or two agreeing independent durable signals is High confidence. One serial or MAC signal is Medium confidence. Durable disagreement lowers the candidate to Low confidence. Reused identifiers or signals pointing at more than one canonical device remain Ambiguous. Every suggested match requires confirmation regardless of confidence.

Repeated serial or MAC evidence alone is treated as a collision, not as permission to merge rows. This protects logical stack/member cases and other identifier reuse. Source rows with the same source ID, or the same serial+MAC pair when no source ID exists, are duplicate rows; differing imported fields are exposed as conflicts.

## Repeat imports

Repeat comparison is against the latest successfully published snapshot for the same provider and source adapter. Workbook filenames are not part of identity.

Rows are classified as New, Changed, Unchanged, Moved, Renamed, Missing, or Ambiguous. A move or rename keeps the same canonical device when durable identity agrees. Multiple change kinds are retained even when one primary classification is shown.

Changed source data produces proposals only. A proposal may update a canonical field when the current canonical value is blank or still equals the previous value supplied by this source. A different canonical value is treated as manually maintained and protected. Observed current-firmware fields may be refreshed from the newest confirmed import, but desired firmware policy, lifecycle decisions, maintenance planning, and audit history are outside the import field set and cannot be changed by this engine.

Missing devices are never deleted. Inactivity is proposed only when the import is explicitly a full-inventory export, and that proposal requires confirmation. If an ambiguous current row shares durable identity evidence with a missing previous row, the inactivity proposal is suppressed as unsafe.

## Persistence boundary

`recordSuccessfulImporterV2Publication` is the only Issue #47 write boundary. In one transaction it stores:

- the successful source snapshot and its rows;
- confirmed provider/source-to-canonical-device crosswalks.

It does not create, update, deactivate, or delete canonical devices. Canonical publication remains Issue #51.

The Prisma schema is now loaded as a schema directory so importer-specific persistence models can stay in a small domain file while the existing core schema remains unchanged.
