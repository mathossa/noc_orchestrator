# Importer v2 regression and performance baseline

Issue #44 establishes a production-data-free baseline for later Importer v2 work. The architecture boundary and product decisions are recorded in [ADR 0001](architecture-decisions/0001-importer-v2-rebuild-boundary.md).

## Synthetic fixture coverage

`src/lib/importer-v2-regression-fixtures.ts` contains small, named cases for:

- Customer -> Business unit -> Site hierarchy;
- blank Firmware Version with populated Software Version;
- two populated firmware evidence fields that require a choice;
- Cisco ROMMON/bootstrap evidence;
- Aruba AOS-S boot and running evidence;
- placeholder firmware evidence;
- stack/member serial reuse;
- repeated device names with distinct durable identifiers;
- duplicate source rows with differing values;
- an explicit device-type exclusion rule;
- unmanaged and end-of-life devices that remain importable with flags;
- conflicting durable identity signals.

All organizations and identifiers are synthetic. The scale generator expands these shapes to 12,000 uniquely identified rows in memory, so tests and benchmarks never require the uploaded workbook.

## Correctness baseline

Run:

```bash
npm test -- src/lib/importer-v2-regression-fixtures.test.ts
```

The suite checks fixture completeness, hierarchy shape, preservation of both firmware evidence columns, repeated-name behavior, durable identity availability, absence of known production names/IP patterns, and stable 12,000-row generation.

These fixtures are contracts for evaluator tests. They intentionally do not encode automatic match results: Importer v2 suggestions still require user confirmation. The pure staged evaluation contract is documented in [importer-v2-evaluation.md](importer-v2-evaluation.md).

## Performance baseline

Run:

```bash
npm run benchmark:importer-v2
```

The benchmark uses the 12,000-row synthetic fixture and records these stable phase names:

| Phase              | Reference workload                                       | Product target                                       |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------- |
| Stage              | Copy raw evidence and calculate normalized lookup values | Included in <=30 s analysis                          |
| Evaluate           | Build explainable confidence and decision records        | Included in <=30 s analysis                          |
| Filter and sort    | Produce a user-visible subset and ordering               | <1 s p95 interaction                                 |
| Validate           | Scan required identity and construct uniqueness indexes  | Included in <=30 s analysis                          |
| Build publish plan | Build bounded before/after audit intents                 | <=30 s atomic publication after database integration |

The `Evaluate` phase now calls the production pure staged evaluator introduced by Issue #45. The other phases remain reference workloads.

This benchmark is not a claim about end-to-end importer performance. It excludes XLSX decompression, network latency, PostgreSQL queries/transactions, audit writes, and browser rendering. Later issues must add integration measurements for those costs while retaining this fixture size and these phase names.

### Baseline environment and results

| Item               | Value                                           |
| ------------------ | ----------------------------------------------- |
| Date               | 2026-09-04                                      |
| Runtime            | Node.js 24.19.0, npm 11.9.0, Vitest 4.1.11      |
| Host               | Linux x86_64, 9 vCPU, Intel Xeon Platinum 8573C |
| Rows               | 12,000 synthetic rows                           |
| Stage              | 13.22 ms mean / 41.45 ms p99                    |
| Evaluate           | 618.36 ms mean / 704.55 ms p99                  |
| Filter and sort    | 1.23 ms mean / 2.95 ms p99                      |
| Validate           | 3.69 ms mean / 6.84 ms p99                      |
| Build publish plan | 0.44 ms mean / 1.44 ms p99                      |

These measurements are a single clean reference run in the Codex workspace. They are not end-to-end acceptance results. Re-run the command on the deployment-class environment when database and XLSX integration benchmarks are added.

## Prototype comparison policy

The Issue #38 branch is a read-only behavioral reference. Future code may independently extract its bounded XLSX parser or small deterministic firmware helpers only after their relevant regression fixtures pass. Prototype screens, staging lifecycle, identity behavior, automatic firmware selection, and canonical-write paths are not the v2 baseline.

There is no production prototype data, so unfinished batches have no migration path. They may be discarded when the old schema is retired.
