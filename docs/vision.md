# Product vision

NOC Orchestrator is a firmware lifecycle and orchestration platform for network operations teams.

Its purpose is to turn scattered observed firmware data into a controlled workflow:

```text
Observe current state
→ resolve desired policy
→ determine compatibility/compliance
→ explain recommended action
→ record exceptions/customer decisions
→ plan maintenance
→ review/report
→ later execute safely
```

## What the product should be

NOC Orchestrator should provide one understandable source for firmware-specific decisions across customers, sites, device families, models, releases, and integrations.

An engineer should be able to answer:
- what firmware is running;
- what policy applies and why;
- whether the device is preferred, accepted, outdated, blocked, incompatible, or unknown;
- what action is recommended;
- whether an exception exists;
- whether work is proposed, approved, scheduled, completed, or stale;
- what was reported/decided previously;
- eventually, whether approved work can be executed safely.

Observed state may come from XLSX, Auvik, Meraki, Aruba Central, FortiManager, or future sources. Those integrations feed one shared inventory/reconciliation pipeline; they do not create separate product silos.

## What the product should not become

NOC Orchestrator is not a replacement for an NMS, source-of-truth platform, ticketing system, vendor controller, PKI platform, secret vault, or SSH library.

Integrate with those capabilities instead of rebuilding them.

## Build principle

Own the firmware domain; reuse the infrastructure.

Custom code should focus on the parts that make NOC Orchestrator distinct: policy/inheritance, firmware interpretation, compatibility/compliance, exceptions, planning, review/reporting, and execution safety.

For generic capabilities—testing infrastructure, queues, browser/PDF generation, graph algorithms, API clients, SSH, parsing, PKI, secrets, and artifact transport—prefer maintained, license-compatible open source or official vendor SDKs.

Reuse must reduce code and operational risk. Do not add a large framework when a small local implementation is clearer, and do not replace working NOC-specific behavior merely to increase dependency reuse.

## Delivery direction

The first release remains a small Next.js/PostgreSQL application focused on inventory, policy, compliance, exceptions, planning, and review readiness.

Later releases add reusable source adapters, recurring sync/report jobs, upgrade-path modelling, and a guarded execution layer using outbound NOC Agents and vendor APIs.