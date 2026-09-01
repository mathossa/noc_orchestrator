# Firmware-focused drill-down views

Issue #14 completes the MVP navigation path from aggregate firmware attention to the exact entity that explains it.

## Required journeys

The application shell exposes the primary overview routes for customers, devices, models, vendors, firmware, and contract types. Detail views then link back into the URL-backed `/devices` query from Issue #13.

Common examples:

- customer -> all customer devices
- customer/site -> site devices
- model -> devices using that model
- vendor -> all vendor devices or a technical/workflow subset
- firmware release -> devices currently on the release
- firmware release -> devices whose exact desired release is the release
- contract type -> devices whose **effective** contract is the contract
- contract/customer or contract/site -> combined filters

## State separation

Every drill-down preserves the product's state model:

- **Current firmware** is recorded inventory state.
- **Desired firmware** is the explicitly resolved exact target.
- **Technical state** is the exact current-versus-desired result.
- **Workflow state** is the independent operational decision.

A workflow state never changes technical compliance.

## Effective contract semantics

Contract drill-downs use the same effective contract resolution as device inventory:

1. site contract override
2. customer default contract
3. no contract

A device is counted against only its resolved effective contract. A customer default must not also count a device whose site overrides that default.

## Vendor view

`/vendors/[id]` shows:

- concrete models and their exact desired release
- device counts
- technical firmware state distribution
- workflow distribution
- firmware release catalog entries
- exact current-device and desired-device release usage
- inventory/catalog provenance and synchronization freshness where available

## Contract view

`/contracts/[id]` shows:

- default-customer assignments
- explicit site overrides
- effective device count
- technical firmware state distribution
- workflow distribution
- customers/sites contributing effective devices
- device provenance and latest synchronization context

## Firmware release view

`/firmware/[id]` links directly to:

- devices whose current release is the selected release
- devices whose desired release is the selected release
- concrete model detail pages
- filtered device lists per model
- the owning vendor drill-down

Catalog status, train membership, release ordering, and release recency remain informational. None automatically changes desired firmware.

## Non-goals

These views do not add monitoring metrics, live reachability, polling, or vendor-version ordering. They remain firmware lifecycle and recorded-inventory views.
