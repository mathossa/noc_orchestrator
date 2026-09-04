# Importer v2 scoped and explainable rule engine

Issue #49 replaces the prototype importer rule behavior with one deterministic,
field-aware engine. It is deliberately limited to import reconciliation. Firmware
planning/lifecycle rules remain a separate domain.

## Evaluation boundary

The canonical import path is:

```text
staged source row
  -> active rule-book revision
  -> effective staged values + rule trace
  -> exact remembered mappings / generic field evaluation
  -> deterministic firmware interpretation (#48)
  -> review / proof
  -> canonical publication (#51)
```

Rules match against an immutable snapshot of the original staged row. One rule
cannot secretly make a later rule start matching. All winning actions are chosen
first and then applied, which keeps evaluation repeatable and explainable.

Legacy `profileRules` in `importer-v2-evaluator.ts` remain only as a lower-level
compatibility shape. `evaluateImporterV2WithRules` removes them before invoking
the lower evaluator so there is never a second competing generalized rule engine.

## Exact memory is not a generalized rule

A confirmed one-to-one alias is persisted as `ImporterV2ExactMapping` and is fed
into the existing exact remembered-mapping layer.

Example:

```text
source: Cisco Systems, Inc.
field:  vendor
maps to: Cisco
```

This does not create a broad `contains Cisco` rule. Generalized rules live in a
separate revisioned rule book and must be created deliberately.

## Rule structure

A rule contains:

- stable rule ID and per-rule version;
- name/description;
- explicit integer priority;
- `DRAFT`, `ACTIVE`, or `DISABLED` status;
- source/inventory scope;
- nested AND/OR condition expression;
- one or more field-aware actions.

Supported scope dimensions:

- profile;
- provider;
- source adapter;
- customer;
- business unit/subdomain;
- site;
- vendor;
- model;
- product family;
- device type;
- source field where applicable.

Supported condition operators:

- exact;
- normalized exact;
- contains;
- prefix;
- safe wildcard pattern (`*` / `?` only);
- version-pattern matching.

`VERSION_MATCH` is pattern matching only. It does **not** perform semantic
firmware ordering and therefore does not compete with the vendor/platform-aware
comparison service from Issue #56.

## Actions

Supported actions:

- `MAP_VALUE` — propose a canonical value/ID for one field;
- `SET_FIELD` — set a staged value;
- `CLEAR_FIELD` — deliberately clear one staged value;
- `IGNORE_FIELD` — ignore one source field while keeping the row in the import;
- `EXCLUDE_ROW` — explicitly exclude the whole row;
- `TRANSFORM_VALUE` — deterministic trim/case/whitespace/literal replacement;
- `SPLIT_HIERARCHY` — split one source value into Customer/Business Unit/Site;
- `MATCH_DEVICE` — propose a canonical device match.

`MATCH_DEVICE` always returns `requiresConfirmation: true`. Rules may propose a
match, but they do not silently accept physical-device identity.

`IGNORE_FIELD` and `EXCLUDE_ROW` are intentionally different. Ignoring a bad
firmware source field cannot make the entire device disappear. The original raw
source value remains in the rule evaluation trace even when the effective value
passed to downstream interpretation is null.

## Priority and conflict handling

Evaluation order is deterministic:

1. higher explicit priority;
2. more specific rule (narrower scope / condition structure);
3. rule ID lexical order;
4. rule version;
5. action index.

Each target field/action slot is resolved independently. A lower tier cannot
replace an already selected higher tier.

If two or more rules at the exact same priority/specificity tier propose
different actions for the same slot:

- no contender is applied for that slot;
- all conflicting rule IDs are returned;
- the row remains review-required;
- preview shows the conflict before activation.

Equivalent same-tier actions are coalesced but every contributing rule remains
visible in the trace.

`SPLIT_HIERARCHY` is atomic. It is applied only when that action wins every target
field it would modify.

## Rule preview and activation safety

`previewImporterV2RuleChange` evaluates a candidate as if it were active, without
persisting or mutating canonical inventory. It returns:

- matched row count;
- excluded row count;
- changed fields;
- affected customers, sites, and models;
- bounded representative before/after examples;
- equal-priority conflicts;
- explicit-confirmation reasons.

Explicit confirmation is required when a rule excludes rows, is unscoped, affects
a broad share of a batch, or introduces a conflict.

The candidate rule replaces the previous version with the same rule ID during
preview. Old output is never JSON-merged with the new definition.

## Versioning and rollback

General rules are stored as immutable complete snapshots:

```text
ImporterV2RuleBook
  -> ImporterV2RuleRevision v1
  -> ImporterV2RuleRevision v2
  -> ImporterV2RuleRevision v3  (active)
```

Creating a revision writes the complete `rules` JSON. It does not merge against
the previous revision. `activeRevisionVersion` can point back to an older revision
for rollback without deleting history.

Exact mappings have their own stable `mappingKey` and monotonically increasing
version. Replacing an exact mapping deactivates the old version and creates a new
one rather than turning it into a generalized rule.

## Decision trace

For every applied action, the row exposes:

- rule ID;
- rule version;
- rule name;
- priority;
- action and action index;
- every evaluated condition with expected/actual value and result.

For field outputs applied through a rule, the importer field decision is marked
`PROFILE_RULE` with the winning rule ID/version. The fuller `ruleEvaluation`
trace remains available for equivalent rules, conflicts, ignored raw evidence,
and device-match proposals.

## Performance

Rules are compiled once per evaluation. A rule with a mandatory exact scope or
mandatory exact condition is indexed by one anchor. Each row builds its relevant
anchor keys and only checks:

- matching anchored rules; and
- genuinely broad rules that cannot be safely indexed.

This avoids a naive `rows × all rules` scan for ordinary rule sets. Regression
coverage includes 12,000 rows and 200 exact-model rules, producing 12,000
candidate checks rather than 2.4 million.

## Safety boundaries

Issue #49 does not:

- create/update firmware releases;
- implement firmware semantic ordering;
- decide model/image compatibility (#57);
- publish staged rows into canonical inventory (#51);
- change desired/recommended firmware policy;
- perform firmware planning or execution.

The rule engine only prepares explainable staged reconciliation decisions for
engineer review.
