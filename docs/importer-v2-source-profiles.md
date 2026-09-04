# Importer v2 source profiles and hierarchy

Issue #46 adds the reusable parsing policy that sits between workbook inspection and staged-row evaluation. It does not publish customers, business units, sites, or devices.

## Recognition and confirmation

A source profile is suggested from a SHA-256 fingerprint of normalized structural evidence:

- provider and source adapter;
- worksheet and header-row position;
- ordered, normalized headers;
- mapped column indexes, headers, and target fields.

The workbook filename is deliberately absent. Renaming a later export therefore does not discard a compatible mapping. Exact and compatible candidates include a score, reasons, and warnings. The result always requires confirmation. Equally strong candidates require a choice, an explicit selection takes precedence, and no eligible candidate proposes creating a new profile.

Confirming a profile persists its sheet/header configuration, column mappings, provider and adapter, hierarchy template, device-type policy, defaults, and exact aliases in `ImporterV2SourceProfile`. Per-import overrides are cloned into an effective profile and never mutate the saved profile unless the user explicitly saves an update.

## Customer hierarchy

The default saved template recognizes:

| Source shape                               | Customer      | Business unit  | Site                                  |
| ------------------------------------------ | ------------- | -------------- | ------------------------------------- |
| `Customer`                                 | first segment | —              | —                                     |
| `Customer - Site`                          | first segment | —              | second segment                        |
| `Customer - Business unit - Site`          | first segment | second segment | third segment                         |
| `Customer - Business unit - Site - suffix` | first segment | second segment | remaining segments joined as the site |

Parsing preserves the raw value and reports the chosen template variant, parsed values, effective values, and issues. Empty or otherwise nonconforming values stay visible. A row-level correction produces an explicit `CORRECTED` result while retaining the original issue as evidence.

## Device-type policy

A profile can remember exact source-type rules with `INCLUDE`, `EXCLUDE`, or `REVIEW` actions. The default can only be `INCLUDE` or `REVIEW`; a row cannot be silently excluded by a catch-all default. Every excluded row identifies the matching profile rule and explanation.

Unknown, Generic Device, Generic, Other, and blank types enter review unless an explicit profile rule handles them. Conflicting exact rules also enter review. This does not block conforming rows from the same file.

The preview returns all evaluated rows plus transparent included, excluded, review, and nonconforming-hierarchy counts. Bounded sample lists support a future UI without requiring the browser to render all 12,000 rows.

## Verification

Run:

```bash
npm run prisma:generate
npm test
npm run typecheck
npm run lint
npm run benchmark:importer-v2
```

Regression data uses synthetic organizations and identifiers only.
