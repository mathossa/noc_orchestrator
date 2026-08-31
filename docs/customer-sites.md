# Customer sites / locations

Issue #24 adds first-class customer sites before manual device inventory is implemented.

## Relationship

```text
Customer 1 ---- * Site
    |
    +---- * Device

Site 1 ---- * Device (optional from Device)
```

A customer may have zero, one, or many sites. A site belongs to exactly one customer.

A device's `siteId` is optional so manual or not-yet-classified inventory can exist before a location is known. When a site is selected for a device, application code must call the shared `assertSiteBelongsToCustomer(siteId, customerId)` guard so the site belongs to the same customer as the device. Issue #8 device CRUD is responsible for using that guard on create/update.

## Site fields

Sites support:

- required human-readable name
- optional customer-scoped code
- optional address line 1/2
- optional postal code
- optional city
- optional region/state
- optional country
- optional notes
- active/archive state
- provenance (`MANUAL`, `API`, `IMPORT`)
- optional external provider / external ID
- synchronization timestamp/metadata reserved by the schema

Only the name is required. A full postal address is deliberately not mandatory because source systems may only know a site name, city, campus, datacenter, or logical location.

## Identity

Site names are unique within a customer after case/whitespace normalization. Site codes, when present, are canonicalized to uppercase and are unique within a customer.

The same site name/code may be reused by a different customer.

Examples:

```text
Customer A / Head Office / HQ
Customer B / Head Office / HQ
```

is valid, while two normalized `Head Office` records under Customer A are rejected.

## UI and API

Customer site management is intentionally customer-scoped:

- `/customers/[id]` shows site count and site summaries
- `/customers/[id]/sites` manages sites
- `/customers/[id]/sites/[siteId]` shows site details
- `/api/v1/customers/[id]/sites`
- `/api/v1/customers/[id]/sites/[siteId]`

Normal manual entry focuses on site/location fields. Provenance and external identity are kept under an advanced/synchronization section.

## Archival and deletion

Archiving is the safe normal removal path and does not move or orphan devices.

Permanent site deletion is blocked when devices or site audit history reference the site. Customer deletion is also blocked while sites exist.

## Device inventory boundary

Issue #24 only prepares the optional device-to-site relationship. It does not implement device CRUD.

Issue #8 will expose site selection on device create/edit and must reject cross-customer site assignments using the shared ownership guard. Later filtering/grouping work in Issue #13 can use `siteId` as a first-class dimension.
