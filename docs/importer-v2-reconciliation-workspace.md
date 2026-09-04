# Importer v2 unified reconciliation workspace

Issue #50 provides the single review surface between immutable Importer v2 evaluation and the explicit publication operation owned by Issue #51.

## One workspace, not entity queues

A staged batch is reviewed at:

```text
/devices/import/[batchId]
```

Every staged device remains reachable from this one workspace. The normal flow does not send engineers to separate Models, Sites, Firmware, or Bulk reconciliation pages. The prototype screens remain only on the historical Issue #38 branch until the final cutover/removal work in #52.

The main grid keeps the source row visible as a device-shaped record with:

- row and review status;
- source name/hostname;
- Customer -> Subdomain/Business Unit -> Site;
- device type;
- source model and proposed canonical model;
- product family and software platform;
- raw `Firmware Version` and `Software Version`;
- deterministically interpreted running firmware and confidence;
- issue count;
- repeat-import classification.

Unknown firmware is therefore visible as review evidence. It does not make the device disappear from the workspace.

## Large-batch query boundary

The browser does not receive the entire approximately 12,000-row batch.

The workspace defaults to 100 rows per page and caps a page at 200. Search, filters, issue counts, and group totals are executed on the server. Supported grouping dimensions include:

- status;
- Customer;
- Subdomain/Business Unit;
- Site;
- vendor;
- device type;
- source model;
- canonical model;
- firmware evidence pattern;
- repeat-import classification.

Group totals are database aggregates and do not depend on which page is rendered.

## Selection semantics

There are two explicit selection modes.

### Explicit rows

```text
ROWS -> [14, 18, 33]
```

This is ordinary checkbox/multi-select review.

### Server-side query scope

```text
QUERY -> vendor=Aruba + model=AP515 + status=NEEDS_REVIEW
```

This means **all matching staged rows**, not merely the visible page. Group-level `Select all` uses this form as well. The right-side inspector states when a server-wide scope is selected so an engineer does not confuse it with a page-only selection.

## Sticky inspector

The right-side inspector remains alongside the grid on wide layouts.

For one row it exposes:

- complete raw evidence;
- canonical proposals;
- decision source and confidence;
- matched parser/rule identifiers and explanations;
- existing canonical comparison ID when present;
- row issues with direct correction entry points;
- durable identity candidates/signals;
- alternative suggestions;
- prior reconciliation decisions.

For multiple rows or a server-side group/filter selection it provides the same action surface and obtains exact affected-row counts, representative samples, and common/mixed field values from the server during preview.

## Corrections do not overwrite evidence

`ImporterV2WorkspaceRow.evaluated` is the immutable evaluated snapshot. Engineer corrections are separate `ImporterV2WorkspaceDecision` records.

A decision can:

- set/link a staged field;
- clear one staged field;
- ignore one source field while keeping the device;
- explicitly exclude the row/device;
- remember an exact one-to-one mapping;
- create a deliberately scoped generalized rule.

The raw source value is never repaired in place. Actions that can change interpretation mark the row `needsReevaluation`; the UI never pretends an earlier model/firmware proof already reflects the correction.

`IGNORE_FIELD` remains different from `EXCLUDE_ROW`.

## Exact mappings versus generalized rules

A repeated one-to-one decision such as:

```text
Cisco Systems, Inc. -> Cisco
```

can be stored through the exact-mapping boundary from #49.

A generalized rule is a different action. The workspace requires an explicit rule scope dimension/value before creating it. The resulting rule is added as a new complete rule-book revision; it does not silently broaden an exact mapping.

## Preview before apply

Every multi-row or single-row reconciliation action follows:

```text
selection + action
        |
        v
server preview
  - exact affected count
  - representative rows
  - common/mixed values
  - scope token
        |
engineer confirms
        |
        v
server rechecks scope token
        |
        +-- changed -> reject as stale; preview again
        |
        `-- unchanged -> append decisions
```

The SHA-256 scope token includes:

- batch ID;
- exact row or query selection;
- exact action;
- every affected row number and `reviewRevision`.

If another correction changes any affected row between preview and apply, the action returns a stale-preview conflict instead of applying against a different scope.

## Persistence boundary

Issue #50 adds three importer-only persistence models:

```text
ImporterV2WorkspaceBatch
  -> ImporterV2WorkspaceRow
  -> ImporterV2WorkspaceDecision
```

Rows carry denormalized display/query fields so pagination, filtering, and grouping do not require decoding all evaluation JSON in the browser. The immutable evaluation JSON remains the evidence source; the denormalized values are workspace indexes/read models.

The workspace performs **no canonical inventory publication**.

It does not:

- create/update canonical devices;
- turn observed firmware into desired/recommended firmware;
- change firmware policy;
- change lifecycle decisions or maintenance planning;
- publish new catalog releases.

Issue #51 owns transactional validation/publication of the exact evaluated snapshot plus confirmed review decisions.

## Accessibility and interaction continuity

- row checkboxes have explicit labels;
- staged rows are keyboard focusable and support Space/Enter selection;
- groups expose `aria-expanded` state;
- issue summaries are buttons that filter directly to error/warning sets;
- correction/apply status is announced through status/alert regions;
- filters, grouping, page, and selection stay in component state while corrections refresh the server data, avoiding unnecessary context loss.

## Deferred to #52

Issue #52 owns final prototype-flow deletion, deeper large-import profiling, targeted recomputation optimization, and complete end-to-end cutover proof. #50 establishes one supported reconciliation interaction model without prematurely deleting the historical prototype implementation.
