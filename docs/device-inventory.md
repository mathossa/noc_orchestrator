# Manual device inventory

Issue #8 turns `Device` into usable first-class MVP inventory without requiring any external integration or live device access.

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

Current firmware is not desired firmware. Issue #9 owns desired policy and Issue #10 owns technical state resolution.

## Firmware observation age

`currentFirmwareObservedAt` is optional. When present, device views show the observation/report age. When it is missing, the UI explicitly reports that the age is unknown rather than inventing freshness.

`currentFirmwareSource` initially supports `MANUAL`, `API`, and `IMPORT` independently of the device inventory record's own `source` field.

## Identity

Device names are customer-scoped. The application rejects case/whitespace-equivalent duplicates and the database has a normalized `(customerId, name)` uniqueness backstop.

The same device name may be used by a different customer.

## UI and API

Routes:

- `/devices` — list/create/edit/archive/reactivate/delete inventory
- `/devices/[id]` — firmware-lifecycle-focused device detail
- `/api/v1/devices`
- `/api/v1/devices/[id]`

The device list understands the existing customer/site entry links:

- `/devices?customer=<customer-id>`
- `/devices?customer=<customer-id>&site=<site-id>`

Issue #13 later provides the reusable cross-dimensional filtering/grouping system; the Issue #8 filters are intentionally local inventory conveniences. Effective contract should become a reusable filter/grouping dimension there as well.

## Deletion and history

Archiving is the normal safe removal path.

Permanent deletion is blocked when device-scoped firmware policy, lifecycle state, or audit history exists. This prevents cleanup from silently destroying firmware lifecycle decisions.

## Deliberate non-goals

Issue #8 does not add:

- live discovery
- SSH/SNMP polling
- interface status
- bandwidth graphs
- CPU/memory/uptime health
- topology
- desired firmware assignment
- technical compliance calculation
- lifecycle decision editing

Those either fall outside NOC Orchestrator entirely or belong to later firmware-lifecycle issues.
