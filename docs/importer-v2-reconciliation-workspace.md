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
- raw `Firmware Version` and `Software Version` when Evidence columns are enabled;
- deterministically interpreted running firmware;
- active issue count;
- repeat-import classification.

Compact view is the default. Raw firmware/software and confidence remain available in the inspector/evidence view rather than permanently consuming horizontal grid space.

Unknown firmware is therefore visible as review evidence. It does not make the device disappear from the workspace.

## Desktop workbench layout

On desktop the importer is a full-height workbench instead of a long document page.

- the main browser viewport does not need to scroll vertically during normal reconciliation;
- header, issue controls, filters, and grouping remain above the work area;
- the device grid consumes the remaining available height and owns its horizontal/vertical scrollbars;
- the inspector consumes the same remaining height;
- the inspector header/tabs and reconciliation controls stay reachable;
- only the inspector detail body scrolls during ordinary evidence/history review.

Narrower layouts fall back to normal page flow.

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

This means **all matching staged rows**, not merely the visible page. Group-level `Select all` uses this form as well. Visible matching checkboxes remain checked while query selection is active, and the workspace states that the selection spans all matching results.

## Focused inspector

The right-side inspector has three explicit views.

### Review

Review is the normal working view. It shows:

- why the selected row currently has its primary status;
- active errors and warnings;
- whether re-evaluation is pending;
- whether durable device identity still requires confirmation;
- identity candidates with confidence and durable evidence;
- the reconciliation editor and exact-scope preview/apply controls.

A row can legitimately be in `NEEDS_REVIEW` while also matching the Warning filter. For example, an unresolved identity confirmation remains blocking even when the only field finding is a warning. The Review view states the blocking reason explicitly.

### Evidence

Evidence contains information needed to verify the proposal rather than operate the normal workflow:

- complete raw source values;
- canonical proposals;
- decision source and confidence;
- parser/rule identifiers and explanations;
- durable identity evidence and context differences;
- alternative suggestions.

### History

History contains:

- repeat-import difference evidence;
- append-only engineer reconciliation decisions and their values/explanations.

## Explicit device identity confirmation

#47 identity suggestions never become canonical device matches automatically. #50 provides the corresponding review interaction.

Depending on the staged identity result an engineer can preview and confirm:

- the single suggested canonical device;
- one candidate from an ambiguous candidate set;
- creation as a new device;
- a manual canonical-device override.

Identity confirmation follows its own preview/apply token pinned to the row `reviewRevision`. Changing the staged row invalidates an old identity preview.

The original identity-resolution evidence remains immutable. Confirmation is an append-only `IDENTITY_RESOLUTION` review decision.

After identity is explicitly resolved it no longer keeps the row in `NEEDS_REVIEW`. Remaining active field findings determine the primary status, so a row with only a firmware warning becomes `WARNING` (with `RECHECK_REQUIRED` as a secondary state when applicable).

## Corrections do not overwrite evidence

`ImporterV2WorkspaceRow.evaluated` is the immutable evaluated snapshot. Engineer corrections are separate `ImporterV2WorkspaceDecision` records.

A decision can:

- set/link a staged field;
- clear one staged field;
- ignore one source field while keeping the device;
- edit several staged fields as one change set;
- explicitly exclude the row/device;
- remember an exact one-to-one mapping;
- create a deliberately scoped generalized rule;
- explicitly resolve staged device identity.

The raw source value is never repaired in place. Actions that can change interpretation mark the row `needsReevaluation`; the UI never pretends an earlier model/firmware proof already reflects the correction.

`IGNORE_FIELD` remains different from `EXCLUDE_ROW`.

## Multi-field change sets

For explicit row selections and server-side query selections, several field corrections can be reviewed as one atomic user workflow.

The engineer can queue earlier fields, fill the final field, and choose **Review N changes**. The currently filled final field is automatically included; it does not require a separate “Add/replace” click.

The server preview receives one `CHANGE_SET` containing each field at most once, calculates the exact affected scope, and returns common/mixed values plus before-to-after confirmation reasons. One confirmation appends the complete set of field decisions to every affected staged row.

## Exact mappings versus generalized rules

A repeated one-to-one decision such as:

```text
Cisco Systems, Inc. -> Cisco
```

can be stored through the exact-mapping boundary from #49.

A generalized rule is a different action. The workspace requires an explicit rule scope dimension/value before creating it. The resulting rule is added as a new complete rule-book revision; it does not silently broaden an exact mapping.

Reusable exact mappings and generalized rules preview their true batch-wide matching scope rather than merely the currently rendered page.

## Preview before apply

Every reconciliation action follows:

```text
selection + action
        |
        v
server preview
  - exact affected count
  - representative rows
  - common/mixed values
  - before -> after reasons
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
- exact action/change set;
- every affected row number and `reviewRevision`;
- the active #49 rule-book revision when a generalized rule is involved.

If another correction changes any affected row between preview and apply, the action returns a stale-preview conflict instead of applying against a different scope.

## Active findings versus historical evidence

Field findings in the immutable evaluated snapshot are historical evidence. Workspace status/filter counters use the currently active findings after confirmed review overlays.

For example, confirming a corrected Model value can resolve the original Model error without deleting that historical evaluator finding. An unrelated firmware warning remains active.

Primary status priority is:

1. excluded row;
2. active error or unresolved required identity confirmation -> `NEEDS_REVIEW`;
3. active warning -> `WARNING`;
4. no active finding but downstream interpretation needs another evaluation -> `RECHECK_REQUIRED`;
5. otherwise -> `VALID`.

`RECHECK_REQUIRED` may also be a secondary status while an error/warning is the primary visible status.

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
- server-wide selections visibly check the rendered matching rows;
- groups expose `aria-expanded` state;
- issue summaries are buttons that filter directly to error/warning sets;
- inspector modes are explicit Review/Evidence/History controls;
- correction/apply status is announced through status/alert regions;
- filters, grouping, page, and selection stay in component state while corrections refresh server data, avoiding unnecessary context loss.

## Deferred to #52

Issue #52 owns final prototype-flow deletion, deeper large-import profiling, targeted recomputation optimization, and complete end-to-end cutover proof. #50 establishes one supported reconciliation interaction model without prematurely deleting the historical prototype implementation.
