# Customer organizational units (#75)

Canonical inventory supports Customer → optional CustomerOrganizationUnit → Site.
Sites retain required customer ownership and existing rows stay ungrouped. There is
no name inference or source-specific `Subdomain` entity. The importer source field
`businessUnit` maps to `CustomerOrganizationUnit`.

## Operations and queries

- Customer detail groups sites by business unit, includes empty/inactive units and
  an Ungrouped bucket, shows site/device counts, and provides create/edit/activate controls.
- Manage sites assigns or removes a unit. Site headers and device site selectors
  show unit context so same-named locations can be distinguished.
- `/api/v1/customers/:id/organization-units`: GET (optional `q`), POST.
- `/api/v1/customers/:id/organization-units/:unitId`: GET, PATCH; DELETE returns
  a conflict with instructions to deactivate. GET includes related sites and counts;
  device links open the existing filtered inventory.
- Unit input: name, code, notes, parentId, isActive, source, externalProvider,
  externalId, lastSynchronizedAt, sourceMetadata. Customer is fixed by the route.
- `listOrganizationUnits(customerId?, search?)` supports reusable cross-customer
  queries; counts include direct sites and their devices, including inactive records.
  Nested descendants are not implicitly rolled up in this first implementation.
- Site APIs accept `organizationUnit=<id>` or `organizationUnit=none`.
- Device queries accept the same filter and `groupBy=organizationUnit`.
  `none` means devices on an ungrouped Site. Devices without a Site remain a
  separate `Unassigned site` bucket and can be queried with `site=none`.
- `organizationUnitSiteWhere` / `organizationUnitDeviceWhere` provide reusable
  Prisma predicates for later dashboards and reports.

Composite foreign keys enforce same-customer Site/unit and parent/child ownership.
Unit mutations lock the Customer row before checking cycles and sibling duplicates.
Sites use normalized-name and code uniqueness within customer + optional unit;
partial indexes preserve null-unit uniqueness. Unit updates and site moves are audited.
Deactivation preserves sites, devices, source identifiers, and history.

## Importer boundary

`resolveCanonicalHierarchy` is a pure resolution contract. Its store-backed preview
is exposed by the reconciliation row API and shown in the inspector after staged
decisions are applied. It resolves Customer, unit, and Site in order. Explicit IDs
and external provider IDs beat names; invalid/unknown strong IDs never fall back
to name matches. Unknown, ambiguous, inactive, or cross-context references remain
review items. No unit is concatenated into a Site or Customer name.

Linking preserves canonical values (including manual ownership) and returns source
hierarchy evidence separately. Explicitly create a missing unit through canonical
CRUD (source IMPORT and metadata are supported), then link it in reconciliation.
A MANUAL unit cannot be converted/overwritten by an IMPORT/API update.

#51 still owns atomic publication, final reevaluation of all readiness conditions,
Device attachment, and writing source evidence inside its publication transaction.
It must revalidate this hierarchy against current canonical records at commit time;
a preview is not authorization to skip those checks. This change does not publish
staged rows, or build the entire #51 transaction. #57 compatibility integration is
unchanged. Units have no firmware-policy scope and no contract override/inheritance.

## Migration and validation

Migration: `20260907150000_customer_organization_units`.
Run `npm run prisma:deploy` and `npm run prisma:generate` after pulling.
All earlier migrations remain unchanged.

Local checks: `npm run typecheck`, `npm run lint`, `npm test`.
The synthetic migration regression runner applies the complete SQL chain to empty
and populated embedded PostgreSQL databases. It tests preserved legacy Site names,
null units, repeated Site names/codes across units, duplicate rejection within a
unit, cross-customer foreign keys, and deactivation of referenced units:

```sh
npm install --prefix /tmp/noc-migration-test --no-package-lock @electric-sql/pglite
PGLITE_MODULE=/tmp/noc-migration-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/tests/organization-unit-migration.mjs
```

Validate locally: create two units for a synthetic Customer, put a `Springfield`
Site in each, leave a third Site ungrouped, move a Site between units, inspect unit
counts and Device filters, deactivate a referenced unit, and inspect an importer
row with an unknown unit. Existing policy and Site > Customer contract behavior
should remain the same. Browser interaction has not been validated in this workspace.
