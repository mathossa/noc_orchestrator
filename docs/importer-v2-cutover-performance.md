# Importer v2 cutover and performance audit (#52)

Base: `main` at `c603a55`. No code from #60 or the #38 prototype was used.

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

Linux x86_64; Node 24.19.0; Vitest 4.1.11. Same synthetic 12,000-row fixture and unmodified `npm run benchmark:importer-v2`, before and after on this workspace.

| CPU phase | Before mean ms | After mean ms |
| --- | ---: | ---: |
| Stage | 18.8235 | 15.6721 |
| Evaluate | 1073.68 | 878.12 |
| Recognize hierarchy/type policy | 79.0403 | 66.6127 |
| Filter and sort interaction | 2.3893 | 2.1018 |
| Validate | 13.3832 | 9.5095 |
| Build publish plan | 0.8379 | 0.6729 |

The CPU code in this benchmark is unchanged. Differences are run-to-run timing variation, **not proof of the database optimizations**. This does not measure XLSX decompression, HTTP payloads, browser rendering, publication I/O or PostgreSQL.

Added `importer-v2-performance.integration.test.ts`, opt-in through `IMPORTER_TEST_DATABASE_URL`, targeting a disposable migrated database. It measures staging persistence, 20 workspace/group samples (p95), five-row correction recheck, and full 12k recheck. It verifies page two, full-batch group counts, and preservation of unrelated pending corrections. Setup uses the existing scale fixture with minimal evaluation JSON: it is not a full XLSX/evaluator benchmark or publication acceptance test.

No PostgreSQL server is installed/available in this workspace, so database tests were **not executed**. The <=30s full analysis and atomic publication targets and <1s database interaction p95 remain unverified.

## Remaining acceptance work

Keep this PR draft and PR #42 open. #52 is not yet fully accepted:

1. Execute the database harness against deployment-class PostgreSQL and record results; extend it with realistic evaluation JSON, publication planning and atomic publication before claiming the 12k publication target.
2. Publication still performs serial row/catalog/identity writes; this audit does not claim to have removed that N+1 cost. Measure it before changing transaction ownership/atomicity.
3. QA is lazy, but its existing full-batch QA payload has not been paginated by this change. Verify/bound it for large imports before declaring all browser payloads bounded.
4. Run the complete XLSX → reconcile → publish → repeat workflow manually, including partial publication, manual ownership protection and unchanged NOC-owned desired firmware, exceptions and lifecycle/planning state.

## Validation and manual checklist

Automated: Prisma generation/validation, unit/regression suite, typecheck, lint, production build and CPU benchmark. The build uses a dummy localhost DATABASE_URL and local build secret; it does not establish database connectivity. Database integration suites are opt-in and skipped here.

Manual:

1. Upload/inspect/stage a 12k synthetic XLSX; visit page two and a later page. Filter/group and compare group totals with the complete matching scope.
2. Select five rows, correct a field, preview/apply. Verify the five affected rows and unchanged unrelated rows, filters, page and selection.
3. Save an exact mapping and a guided scoped rule matching rows beyond the current selection/page. Confirm complete preview count and results. Change a row after preview; stale apply must reject.
4. Use Recheck corrections and Apply saved automations; ensure context survives. Check Network for a single identical pending workspace/detail GET per revision; no QA request before opening Final QA.
5. Publish resolved rows, retry the same request, and run partial publication with unresolved rows remaining staged. Confirm observed firmware and manual canonical-field protection. Confirm desired firmware, exceptions and lifecycle/planning are preserved.
6. Repeat the export with changed source-owned values and renamed devices; verify identity/diffs and protected fields.

Only after these gates pass should PR #42 be closed as superseded, without merging or deleting its branch/history.
