# Customer sites / locations

Issue #24 adds first-class customer sites before manual device inventory is implemented. Issue #8 extends sites with an optional contract override because some customer locations can be covered by a different service agreement than the customer's default.

## Relationship

```text
Customer 1 ---- * Site
    |
    +---- * Device

Site 1 ---- * Device (optional from Device)
```

A customer may have zero, one, or many sites. A site belongs to exactly one customer.

A device's `siteId` is optional so manual or not-yet-classified inventory can exist before a location is known. When a site is selected for a device, application code must call the shared `assertSiteBelongsToCustomer(siteId, customerId)` guard so the site belongs to the same customer as the device.

## Contract inheritance

`Customer.contractTypeId` is the customer-level **default contract**. `Site.contractTypeId` is optional and only exists when a location has a different agreement.

Effective contract resolution is deliberately simple:

```text
Site contract override
        ↓
otherwise Customer default contract
        ↓
otherwise No contract
```

Examples:

```text
Customer: Fully Managed
├── Head Office     → inherits Fully Managed
├── Datacenter      → Firmware Management (site override)
└── Small Branch    → Monitoring Only (site override)
```

A site override does not mutate the customer's default contract and does not copy the contract onto each device. Devices assigned to a site resolve their effective contract from the site first and the customer second.

Archived contract types remain visible on existing site references, but cannot be newly selected through the normal site UI. A contract type referenced by a customer, site, or firmware policy cannot be destructively deleted.

## Site fields

Sites support:

- required human-readable name
- optional customer-scoped code
- optional contract type override
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

The primary navigation groups customer inventory as:

```text
Customers
├── Overview
└── Sites
```

`/sites` is a global cross-customer site overview with customer, search, and archive filters. It shows the effective contract and whether it comes from the site override or customer default.

Creation and editing remain customer-scoped because a site cannot exist without an owning customer:

- `/sites` browses all sites across customers
- `/customers/[id]` shows site count and site summaries
- `/customers/[id]/sites` manages sites, including contract overrides, for one customer
- `/customers/[id]/sites/[siteId]` shows site details and contract inheritance context
- `/api/v1/sites` lists all sites
- `/api/v1/customers/[id]/sites`
- `/api/v1/customers/[id]/sites/[siteId]`

Normal manual entry focuses on site/location and contract context. Provenance and external identity are kept under an advanced/synchronization section.

## Archival and deletion

Archiving is the safe normal removal path and does not move or orphan devices.

Permanent site deletion is blocked when devices or site audit history reference the site. Customer deletion is also blocked while sites exist.

## Device inventory

Issue #8 exposes site selection on device create/edit and rejects cross-customer site assignments using the shared ownership guard.

The device list/detail resolves the effective contract from the selected site override first and the customer default second. Later filtering/grouping work in Issue #13 can use both `siteId` and effective contract as first-class inventory dimensions.
