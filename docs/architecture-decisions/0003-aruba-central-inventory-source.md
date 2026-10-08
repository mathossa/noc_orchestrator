# HPE Aruba Central inventory sync — Issue #116

This branch begins the Aruba adapter independently of ongoing Meraki #115 work.
The architecture follows `AGENTS.md` and the existing `InventorySourceAdapter`
contract. It deliberately does **not** add a second importer or publication path.

## Product variants

The user must choose `NEW` or `CLASSIC` Central and supply the
corresponding account-specific API gateway URL. Credentials/endpoints cannot
cross product variants.

- **New Central**: HPE GreenLake client credentials, Central-scoped OAuth
  `client_credentials` token via
  `https://sso.common.cloud.hpe.com/as/token.oauth2`.
  Inventory: `GET /network-monitoring/v1/devices` with `limit` and `next`
  cursor pagination. Access tokens are short-lived; new requests can renew
  via client credentials. No refresh-token grant is assumed for this variant.
- **Classic Central**: uses its **own** API gateway, API application and
  OAuth refresh-token semantics; device API shapes/paths differ. Classic
  client support is now the first implementation priority within #116:
  the Classic API client uses `/monitoring/v2/aps`,
  `/monitoring/v1/switches`, `/monitoring/v1/gateways` with offset/limit
  pagination. Refresh uses `POST /oauth2/token` with the rotating refresh
  token; the calling connection store must persist both rotated tokens
  before continuing. Classic API requests must never use New Central tokens.

## Initial code slices (Classic-first for the target environment)

- New Central OAuth access token request and safe bearer-token destination
  validation.
- Monitored devices endpoint, bounded pagination and retry handling for
  429/transient 5xx; 401 leads to exactly one token renewal.
- Safe refusal to silently publish an incomplete device list.
- Device normalization to the existing Importer v2 adapter contract.
- Aruba's source-local identifier and serial/MAC remain separate from
  canonical Device identity; Importer v2 cross-provider reconciliation from
  #121 remains responsible for matching.
- Preserve observed ONLINE/OFFLINE/DORMANT status and group/site/firmware
  evidence in `sourceEvidence`. These are **not** NOC-owned lifecycle states.
- Customer mapping is explicit; an Aruba device group cannot be assumed
  to be a customer or business unit. Site IDs require mapping if Central
  does not return a site name.
- Classic EU/US/APAC documented gateway URL allowlist, Classic token
  refresh and fail-closed AP/switch/gateway collection.
- Classic raw status, group/site and running firmware evidence through
  the same Importer v2 adapter contract.
- No additional runtime dependency.

## Next implementation slices (same issue)

1. Stored encrypted credentials including **rotated Classic refresh tokens**,
   connection test, explicit product variant,
   base URL/region, site/group discovery and selection with a persisted
   **enabled** flag. Discovery only on explicit "Sync organizations & sites",
   not on each sync.
2. Shared Importer v2 staging/reconciliation/auto-publication and provider-
   neutral run history, using the existing Meraki/Auvik patterns after
   #115 stabilization. Scheduled runs must not block awaiting a user:
   safely matched observations auto-publish, ambiguous observations
   remain reviewable diagnostics without preventing the rest of the run.
3. Manual sync and editable scheduled sync using pg-boss; transient device
   status must be recorded in the import/evidence UI (not silently mapped to
   ignored), and dormant/offline observations should be periodically
   rechecked where included by selected scope.
4. Persistent and per-run ignore management via shared importer mechanisms.
   Scope deselection does not delete canonical devices. Never treat a
   partial API failure as an authoritative full export.
5. Harden Classic Central with real-tenant response fixtures and SSO-compatible
   token creation via the API Gateway UI. Validate actual group/site discovery
   and state mapping; support New Central via its existing separate client.

## Vendor documentation

- https://developer.arubanetworks.com/new-central/docs/getting-started-with-rest-apis
- https://developer.arubanetworks.com/new-central/docs/generating-and-managing-access-tokens
- https://developer.arubanetworks.com/new-central/docs/making-api-calls
- https://developer.arubanetworks.com/new-central/reference/getdevicesv1
- https://developer.arubanetworks.com/central/docs/rest-api-getting-started
- https://developer.arubanetworks.com/central/docs/access-token-management
- https://developer.arubanetworks.com/central/reference/apiexternal_controllerget_aps_v2
- https://developer.arubanetworks.com/central/reference/apiexternal_controllerget_switches

## Validation limitations

Unit tests for the client and adapter use representative vendor-documented
payloads and mocks. No Aruba tenant credentials have been supplied, and
this partial branch has not yet been validated against a real Central
account. Do not mark #116 complete or merge this draft before the remaining
acceptance criteria and CI validation are satisfied.

## Classic token lifecycle operational caveat

Classic Central access tokens expire after ~2 hours; rotating refresh tokens
are valid for 15 days. Because a new access token generated directly via the
Classic OAuth flow is rate-limited, store the rotated refresh token encrypted
immediately and design recurrent sync to refresh while the refresh token
is still valid (even for disabled/infrequent inventory sync, if the connection
remains configured). If renewal fails or the token expires, show actionable
re-authentication status; **never** silently attempt to reuse New Central auth.

Classic official API gateway hosts include the EU-1
`eu-apigw.central.arubanetworks.com` and EU-Central2
`apigw-eucentral2.central.arubanetworks.com` origins, not the new
`de1.api.central.arubanetworks.com`/etc. gateway format.


## Classic Central single-customer tenant scoping

A Classic Central connection represents **one customer Central account**. The
integration never assumes an MSP account or discovers MSP customers. The
connection's `customer` selects the NOC hierarchy destination. Many physical
Central sites may exist under the single connected account.

On-demand `Discover Central sites` reads `GET /central/v2/sites` first. If
that endpoint returns zero sites, it reads Classic AP/switch/gateway monitoring
once and collects only real `site`/`site_name` fields. Configuration
`group`/`ap_group` values remain diagnostic evidence, **never implicitly
converted into physical sites**. Discovery returns non-sensitive counts of
sites, observed devices, unassigned devices and groups, so a zero-result UI
is actionable. Previously selected/mapped sites are preserved across
rediscovery. New sites start disabled until the operator saves.

Two explicit inventory scopes exist and are persisted per connection:

- `SELECTED_SITES` (default/backward-compatible): fetch tenant inventory and
  stage only devices whose observed Central site belongs to an enabled scope.
- `ALL_DEVICES` (opt-in): stage **all** devices from this customer tenant,
  including devices without a Central site. Existing site mapping is applied
  where available; unresolved devices remain subject to Importer v2 identity
  and hierarchy review, and safe auto-publication rules stay authoritative.

Both are deliberately non-full exports. Turning off a site or switching modes
does **not** remove devices from the NOC canonical inventory. Actual Aruba
site assignments must be managed in Aruba Central, not inferred from
configuration groups. MSP `TenantID` dispatch is outside this single-customer
connection scope.
