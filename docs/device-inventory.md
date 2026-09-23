# Manual device inventory

Issue #8 turns `Device` into usable first-class MVP inventory without requiring any external integration or live device access. Issue #9 adds desired firmware resolution through the device model while keeping it separate from recorded current state.

## Core rule

Device inventory is **recorded state**, not monitoring or discovery.

NOC Orchestrator does not SSH to a device, poll SNMP, test management reachability, or query a controller as part of device create/edit. An engineer can enter a device entirely manually.

## Required and optional data

A manual device requires:

- customer
- device model
- customer-scoped device name

Optional context includes:

- customer site/location
- hostname
- serial number
- management address
- current firmware release
- current-firmware source
- current-firmware observed/reported timestamp
- notes
- inventory provenance
- external provider / external ID

Contract context is derived rather than duplicated onto the device.

## Customer, site, and contract ownership

A device belongs to exactly one customer.

`siteId` is optional. When it is set, `assertSiteBelongsToCustomer(siteId, customerId)` is called on create and update. Cross-customer site assignments are rejected.

Changing a device's customer therefore requires either:

- no site assignment, or
- a site belonging to the new customer.

The customer contract is the default, but a site may have an optional contract override. The device's effective contract resolves as:

```text
site.contractType
    ↓ when present
customer.contractType
    ↓ otherwise
no contract
```

This supports customers whose locations have different service agreements without copying contract state onto every device.

The device list, create/edit form, and device detail page show the effective contract and whether it came from a site override or the customer default.

## Model and firmware integrity

A device belongs to one `DeviceModel`, which provides its vendor, model, device type, and optional platform/family.

Recorded current firmware is optional. When a firmware release is selected:

1. the release must exist in the firmware catalog;
2. its vendor must match the device model vendor;
3. if the model declares a platform/family, the release platform/family must match after case/whitespace normalization.

Archived/deprecated catalog releases may still be recorded as **current** firmware because inventory must be able to describe old devices accurately.

Current firmware is not desired firmware. Desired firmware is resolved independently from the model's exact active baseline policy. It may therefore be absent even when current firmware is recorded, and changing desired firmware never changes the recorded current release.

Issue #10 owns technical state resolution and will eventually compare these layers into states such as CURRENT, ACTION REQUIRED, AHEAD, UNKNOWN, and NO POLICY.

## Firmware observation age

`currentFirmwareObservedAt` is optional. When present, device views show the observation/report age. When it is missing, the UI explicitly reports that the age is unknown rather than inventing freshness.

`currentFirmwareSource` initially supports `MANUAL`, `API`, and `IMPORT` independently of the device inventory record's own `source` field.

## Identity

Device names are customer-scoped. The application rejects case/whitespace-equivalent duplicates and the database has a normalized `(customerId, name)` uniqueness backstop.

The same device name may be used by a different customer.

## UI and API

Routes:

- `/devices` — attention-driven estate overview grouped by customer
- `/devices/customers/:customerId` — customer inventory grouped by site
- `/devices/customers/:customerId/sites/:siteId` — site inventory grouped by canonical device type
- `/devices/customers/:customerId/sites/:siteId/types/:deviceTypeId` — bounded individual-device list
- `/devices/manage` — existing manual inventory create/edit/archive/delete workspace
- `/devices/[id]` — device workspace with Overview, Firmware, Compliance, Network, Notes & issues, and History sections. Overview keeps common network-device identity, firmware target/status, maintenance, contract, and source facts visible without exposing every diagnostic field at once.
- `/api/v1/devices` and `/api/v1/devices/[id]` — existing CRUD/query contracts
- `/api/v1/inventory/export` — scoped customer/site/device-type CSV export

The explorer is server/query backed. It reads compact device identity and hierarchy facts, resolves firmware compliance with the existing batch resolver, applies the existing exception resolver, and rolls the presentation status upward. Individual display rows are fetched only after bounded pagination. The browser never receives the whole inventory in order to group it.

The device workspace deliberately remains inventory/lifecycle focused. Its Network section currently exposes recorded management identity and provenance only; it does not turn NOC Orchestrator into an NMS by adding live interface, traffic, uptime, polling, or topology monitoring.

### Primary inventory status

Issue #107 adds one presentation-only status so overview users do not need to interpret technical compliance, exceptions, planning, contract, and source columns at once. It never overwrites those underlying states.

Precedence is deterministic:

1. blocked or incompatible technical state → **Critical attention**;
2. due/expired exception on actionable technical work → **Review required**;
3. active accepted exception on non-critical work → **Exception** (not immediate attention);
4. required technical update → **Update required**;
5. review-required technical state → **Review required**;
6. recommended update or platform migration → **Update recommended**;
7. unresolved firmware/policy/comparison context → **Unknown**;
8. no technical action → **Current**.

Attention therefore means every primary status except Current and an active accepted Exception. The same status is rolled Device → Device type → Site → Customer → estate overview, with higher-severity attention sorted first.

The current schema has no canonical hardware lifecycle/EOL field. The explorer therefore does not invent an EOL/replacement KPI from exception reason text. A future lifecycle source can add that count without changing the primary-status boundary.

Search is scoped by the route and is pushed into PostgreSQL for device name, hostname, serial number, management address, customer, site, model, vendor, and device type. Advanced filters are collapsed behind a Filters action. Customer/site navigation context is not repeated as a permanent dropdown.

A useful contract-inheritance smoke test is:

```text
Customer default: Fully Managed
├── HQ           → inherit customer default
└── Datacenter   → Firmware Management override
```

Devices placed at HQ should resolve `Fully Managed / Customer default`; devices placed at Datacenter should resolve `Firmware Management / Site override` in both list and detail views.

## Deletion and history

Archiving is the normal safe removal path.

Permanent deletion is blocked when device-scoped firmware policy, lifecycle state, or audit history exists. This prevents cleanup from silently destroying firmware lifecycle decisions.

Contract types are also protected from destructive deletion while referenced by a customer, site override, or firmware policy.

## Deliberate non-goals

The inventory and Issue #9 policy work do not add:

- live discovery
- SSH/SNMP polling
- interface status
- bandwidth graphs
- CPU/memory/uptime health
- topology
- technical compliance calculation
- lifecycle decision editing

Those either fall outside NOC Orchestrator entirely or belong to later firmware-lifecycle issues.
