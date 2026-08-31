# Customer management

Issue #5 adds customer CRUD, customer detail, contract association, and firmware-lifecycle summary foundations.

## Customer ownership and provenance

Customers are first-class NOC Orchestrator records and do not require an external integration.

A manually managed customer uses:

- `source = MANUAL`
- no `externalProvider` requirement
- no `externalId` requirement

The initial API/UI also supports `API` and `IMPORT` source values with optional provider/external identity fields. These inventory/provenance fields remain structurally separate from NOC Orchestrator-owned firmware policy, lifecycle decisions, and audit history.

## Contract association

A customer may reference one configured `ContractType`, or no contract type.

The customer detail page shows the contract's `firmwareManagementEnabled` capability, but customer management does not implement contract-driven policy or planning rules.

Archived contract types remain visible for existing historical associations but are disabled for new selection in the customer form.

## Archival and deletion

`Customer.isActive = false` is the normal safe archival path.

Permanent deletion is blocked when the customer is referenced by:

- devices
- customer-scoped firmware policies
- customer audit events

This protects inventory and lifecycle history. The API returns HTTP 409 and directs the operator to archive instead.

## Firmware lifecycle summary

`/customers/[id]` shows real data available at this stage:

- device count
- current workflow counts for `PLANNED`, `IGNORED`, `CUSTOMER_DECLINED`, and `DONE`
- contract firmware-management capability
- provenance/synchronization context

Desired-state compliant vs action-required counts are intentionally not independently implemented in Issue #5. Issue #10 owns the canonical technical-state resolver. The customer detail API already exposes a stable `desiredStateSummary` shape with `available=false` so that Issue #10 can populate it without redesigning the customer page.

## Device entry point

The customer detail page links to:

```text
/devices?customer=<customer-id>
```

The device route exists now; customer-aware device inventory/filter behavior is implemented by the later device/filtering issues.

## API

```text
GET    /api/v1/customers
POST   /api/v1/customers

GET    /api/v1/customers/{id}
PATCH  /api/v1/customers/{id}
DELETE /api/v1/customers/{id}
```

Validation errors return HTTP 400. Duplicate customer codes and referenced-delete conflicts return HTTP 409. Unknown customer IDs return HTTP 404.
