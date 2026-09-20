# Importer v2 cutover and performance audit (#52)

Started from current `main`; later merged the #98 shared Testcontainers/Playwright foundation from `main`. No code from #60 or the #38 prototype was used.

## Reachable production path

| Step | UI | API under `/api/v1/device-import-v2` | Service boundary |
| --- | --- | --- | --- |
| Inspect | `importer-v2-upload` | `xlsx/inspect` | ingestion-store, xlsx-reader, xlsx, source-profiles |
| Stage/evaluate | upload and batch-list | `batches` | ingestion-store → firmware-evaluation/rule-evaluation → workspace-store → workspace-maintenance |
| Review | workspace-frame → workspace-shell → inspector | `batches/:id/workspace`, `rows/:row`, `rows/:row/choices` | workspace-store, canonical-choices |
| Correct | inspector | `actions`, `rows/:row/identity` | workspace-store, effective-overlay, workspace-identity, identity-repair, maintenance |
| Reusable rules | inspector guided rule controls | `rules`, `automation` | rule-wizard-store, rule-store, compiler/engine/preview, maintenance |
| Recheck | workspace-frame | `recheck`, `identity/verify` | maintenance, identity-repair, bulk-identity, stack/derived identity stores |
| Validate/publish | publication-panel, mounted only after Final QA opens | `publication` | publication-store, publication, publication-firmware, canonical-hierarchy-store, identity diagnostics |
| Repeat | upload and same workspace | same inspect/stage routes | identity-store snapshot reads, identity, repeat-diff, publication-store snapshot writes |
| Delete unpublished batch | batch-list | `batches/:id` DELETE | maintenance; publication history prevents deletion |

The only importer pages are `/devices/import` and `/devices/import/[batchId]`.
Repository-wide reference searches found no prototype/entity-specific reconciliation page or legacy import API on this main. The historical prototype is confined to PR #42's branch; no deletion was justified solely by filenames.

### Consolidation and intentional retention

- Consolidated duplicate rule-book creation in maintenance and guided rules into `importer-v2-workspace-rule-book.ts`.
- Retained the inspector's guided rule editor: it is a control within the flat workspace, not the old entity wizard.
- Retained lower-level generic evaluator/profile-rule compatibility shapes; the production firmware/rule facades remain the authoritative interpretation path.
- Retained `recordSuccessfulImporterV2Publication` as the tested #47 snapshot/crosswalk compatibility helper. Reference search finds only its definition and identity-store tests; **no production route calls it**. Production publication remains `publishImporterV2Batch`. It is not an alternative device publisher or API endpoint.
- No API compatibility shim was added. Staging reads catalog snapshots and writes importer/source-profile records, not canonical model/platform records.

## Request and recomputation changes

- Workspace, selected detail, and initial QA reads share identical pending GETs, including React effect replay. Response bodies are cloned for independent consumers. Completed responses are not cached.
- Correction/maintenance revisions distinguish new reads from older pending requests. Explicit QA refreshes always use a fresh request.
- Maintenance refreshes the mounted workspace through a revision prop; filters, grouping, page and selection survive.
- Ordinary correction identity repair and pending recheck use the persisted action scope token. Reusable mappings retain the complete resolved scope, rather than substituting selected checkboxes for rule impact.
- Guided rules still preview the full included batch and reject conflicts. Their scope token now also includes batch identity and row review revisions. Applying a rule recomputes rows receiving fresh decisions only.
- Explicit batch automation still deliberately inspects the full batch, including topology detection.
- Recheck reads keyset pages of 200, writes at most ten distinct rows concurrently, and guards each write with `reviewRevision`. A newer correction remains pending if its revision changed. This is bounded row-specific Prisma I/O, not bulk SQL; there is still one write per successfully recomputed row.
- Existing grouped overlay writes, atomic decision createMany/updateMany, publication transactions and snapshot createMany are retained. No schema migration or index was added without query-plan evidence.

## Measurement

Linux x86_64; Node 24.20.0; Vitest 4.1.11; Docker-backed PostgreSQL 17 through the shared #98 Testcontainers foundation.

The existing CPU benchmark still uses the same synthetic 12,000-row fixture. Its evaluator code is unchanged, so CPU timing variation is not used as evidence for the database optimizations.

Real PostgreSQL integration measurements from the #52 branch:

| Database phase | Measured |
| --- | ---: |
| Stage 12,000 workspace rows | 9,356.7 ms |
| Workspace + customer groups, p95 over 20 reads | 17.83 ms |
| Targeted five-row correction recheck | 22.16 ms |
| Deliberate whole-batch 12,000-row recheck | 10,069.98 ms |
| Stage 12,000 publication rows | 10,332.39 ms |
| Build 12,000-row Final QA | 395.72 ms |
| Atomic 12,000-device publication | 12,779.66 ms |

The publication benchmark initially failed: the original row-by-row catalog/identity/device path exceeded Prisma's 120-second interactive transaction timeout. #52 now uses a bounded bulk path for clean new-device batches with already-resolved canonical IDs: catalog references are validated once per batch, identity conflicts are checked in bounded groups, and device/crosswalk/workspace writes use chunked bulk operations inside the same serializable transaction. Existing-device updates, repeat imports, stacks and proposal-creation cases retain the established row-safe path.

The shared PostgreSQL tests now cover:
- 12,000-row staging, server pagination/group aggregation and bounded correction rechecks;
- 12,000-row atomic publication under the 30-second budget;
- real repeat publication where source-owned values update but a manually maintained canonical hostname remains protected;
- a complete synthetic XLSX → evaluate → reconcile → recheck → Final QA → publish → second XLSX → repeat-diff → repeat-publication cycle.

Final QA generation is fast in the measured 12,000-row case, but the QA response intentionally remains a whole-batch review summary rather than a paginated workspace endpoint. Workspace row browsing and group counts are server-side and bounded. If QA evidence/proposal payloads become materially larger with future importer features, pagination/summary decomposition should be handled as follow-up work rather than reintroducing all-row workspace reads.

## Acceptance status

- One supported Importer v2 staging/reconciliation/publication path remains on `main`; the historical #38 prototype remains isolated in PR #42.
- No competing entity-specific reconciliation route/page is reachable from the supported workflow.
- Identical pending importer reads are coalesced; completed responses are not cached.
- Workspace lists are server-paginated and group counts are database aggregates.
- Targeted corrections re-evaluate the persisted action scope rather than the whole batch.
- Approximately 12,000-row PostgreSQL performance tests run automatically through Testcontainers.
- The <1s interaction and <=30s whole-analysis/publication budgets are met with evidence above.
- The complete upload → evaluate → reconcile → validate → publish → repeat-import cycle is covered by a real PostgreSQL integration test using a generated synthetic XLSX.
- Repeat import loads current canonical device values before diffing, allowing source-owned updates while protecting manual canonical changes.

PR #42 should remain open until PR #96 is merged to `main`. After #96 lands, close #42 as superseded without merging; its closed PR/branch history remains the prototype reference.

## Validation and manual checklist

Automated validation completed on this branch includes the targeted publication regression suite, typecheck, lint, the shared real-PostgreSQL integration tests, the 12,000-row workspace/recheck benchmark, the 12,000-row atomic publication benchmark, repeat-publication ownership safety, and the complete synthetic XLSX functional cycle.

Manual:

1. Upload/inspect/stage a 12k synthetic XLSX; visit page two and a later page. Filter/group and compare group totals with the complete matching scope.
2. Select five rows, correct a field, preview/apply. Verify the five affected rows and unchanged unrelated rows, filters, page and selection.
3. Save an exact mapping and a guided scoped rule matching rows beyond the current selection/page. Confirm complete preview count and results. Change a row after preview; stale apply must reject.
4. Use Recheck corrections and Apply saved automations; ensure context survives. Check Network for a single identical pending workspace/detail GET per revision; no QA request before opening Final QA.
5. Publish resolved rows, retry the same request, and run partial publication with unresolved rows remaining staged. Confirm observed firmware and manual canonical-field protection. Confirm desired firmware, exceptions and lifecycle/planning are preserved.
6. Repeat the export with changed source-owned values and renamed devices; verify identity/diffs and protected fields.

The automated parity gates above now pass. Keep PR #42 open only until PR #96 is merged; then close #42 as superseded without merging or deleting its branch/history.
