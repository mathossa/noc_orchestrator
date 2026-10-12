# Firmware documentation discovery (#103)

## Goal and scope

Attach links to the canonical **FirmwareRelease**, never independently to the
device or to a work-plan target. That lets the same reference appear for a
recorded **running** release, an effective **preferred** release, and a
work-plan's **exact immutable targetFirmwareReleaseId**.

Release documentation is **live metadata**, not a rewrite of historic firmware
observations or work-plan target snapshots. It is not compliance advice, vendor
endorsement, or a claim that an upgrade path is safe.

## Current implementation

- `FirmwareReleaseDocument` stores typed manual links and notes against a
  canonical release ID (release notes, guides, downloads, known issues,
  compatibility, security, internal runbooks, other).
- `GET /api/v1/firmware-releases/:id/documentation` combines maintained links,
  the existing `releaseNotesUrl`, and conservative automatic suggestions.
  `POST` creates a maintained link; `PATCH/DELETE` are on `/:documentId`.
- The release detail can add/edit/delete maintained links; device firmware tab
  shows **running** and **preferred** documentation; work-plan detail resolves
  links through the snapshotted exact target ID. Device observations without a
  canonical firmwareReleaseId do **not** get a guessed exact match.
- Suggestions are read-time and idempotent, with no provider credentials and no
  writes during inventory publication or scheduled sync.
- `origin` distinguishes manual, legacy and auto-suggested links; `match`
  distinguishes EXACT_VERSION from PLATFORM_INDEX; `verifiedAt=null`
  explicitly means a link has not been checked. A predictable URL path is
  **not** the same as HTTP-verified release documentation.
- All curated links must use HTTP(S) without embedded credentials. Sources are
  outbound links, not downloaded or scraped licensed vendor documents.

## Manufacturer-owned sources and matching strategy

| Supplier/platform | Source / API | Matching strategy | Current depth |
|---|---|---|---|
| Fortinet FortiOS | https://docs.fortinet.com/document/fortigate/7.6.4/fortios-release-notes | Official URL path by exact X.Y.Z version; not verified for arbitrary versions | Version-derived link |
| Fortinet FortiSwitchOS | https://docs.fortinet.com/document/fortiswitch/7.4.6/fortiswitchos-release-notes | Exact X.Y.Z path; do not reuse FortiOS path | Version-derived link |
| HPE Aruba AOS-S | https://arubanetworking.hpe.com/techdocs/AOS-Switch-RN/Content/home.htm | Switch series/image family (e.g. 2530/2930, WC/YA/YB) | Platform index |
| HPE Aruba AOS-CX | https://arubanetworking.hpe.com/techdocs/AOS-CX/Consolidated_RNs/Portal_Home/Content/cx-home.htm | Model/switch series and train must be selected | Platform index |
| HPE Aruba AOS-8 | https://arubanetworking.hpe.com/techdocs/ArubaDocPortal/content/new-portal/aos8.html | Controller AOS-8 documentation family | Platform index |
| HPE Aruba Instant AOS-8 | https://support.hpe.com/hpesc/public/docDisplay?docId=sd00007106en_us | Distinct Instant release-notes family | Platform index |
| HPE Aruba AOS-10 | https://arubanetworking.hpe.com/techdocs/AOS_10.x_RN_WebHelp/Content/Home.htm | Version selection within consolidated notes | Platform index |
| HPE Networking Instant On | https://instant-on.hpe.com/techdocs/en/content/whats_new/release-notes.htm | AP/cloud and switches have different firmware | Platform index |
| Cisco IOS XE 17 / 26 | https://www.cisco.com/c/en/us/support/ios-nx-os-software/ios-xe-17/products-release-notes-list.html | Release family and **device model**; do not infer one document from version alone | Release family index |
| Cisco Meraki MR/MS/MX | https://documentation.meraki.com/Platform_Management/Product_Information/Compatibility_and_Firmware | Product-family release notes; no guessed individual deep links | Portal index |
| Juniper Junos OS | https://www.juniper.net/documentation/product/us/en/junos-os#cat=release_notes | Exact **non-service** Junos R release when syntactically unambiguous (e.g. 24.2R2); otherwise fall back to catalog | Exact-version suggested link / platform index |
| MikroTik RouterOS | https://mikrotik.com/download/changelogs | Select exact version and channel | Changelog index |
| Other vendors | Manually maintained typed URL | Never fabricate an unverified deep link | Manual |

### Meraki API: recommended next adapter

A first-party Meraki API **beta** provides a stronger route to exact match:

1. `GET /organizations/{organizationId}/devices/software/versions` exposes
   the vendor `id`, `productType`, `shortName`, release type, and release date.
2. `GET /organizations/{organizationId}/devices/software/versions/changelogs`
   accepts `versionIds` and returns changelog content for those IDs.
3. Match `productType` and exact `shortName`/canonical version (not a
   cross-family numeric-only match). Retain the Meraki vendor version ID in
   structured provider metadata. Only attach exact-version documentation when
   the source identifier is unambiguous. Do not attach a generic MR changelog to
   MS or MX.
4. Use encrypted credentials and allowed organizations from merged Meraki inventory integration
   #115 after bringing this PR branch up to the new main; no credentials or API requests should be duplicated by
   this issue's core docs model. No manual reconciliation in scheduled jobs.
5. This API is marked **BETA** by Cisco; support capability detection, skipped/
   unsupported organizations and retry/backoff. If no stable public release
   URL is returned, render the changelog as source-attributed metadata rather
   than inventing a URL. Respect usage/redistribution terms.

References:
- https://developer.cisco.com/meraki/api-v1/get-organization-devices-software-versions/
- https://developer.cisco.com/meraki/api-v1/get-organization-devices-software-versions-changelogs/

### HPE Central and Cisco

- HPE AOS-CX release notes differ by switch series. Match vendor + platform +
  **model family** + exact train, never only software version; AOS-S, ArubaOS,
  Aruba Instant, and AOS-CX are separate software families. Investigate
  supported machine-readable HPE support catalogs/portals and entitlement
  requirements before automating exact deep links.
- Cisco IOS XE release notes differ by hardware/product line, not only train.
  Prefer product/support metadata and official product index pages. Where a
  stable, supported vendor API is unavailable, use a reviewable/manual link
  rather than fragile portal scraping.
- No device SSH or NMS polling is needed for documentation; existing inventory
  reconciliation supplies running firmware identity.

## Future background ingestion

Once authenticated provider APIs are available, add a source-adapter contract
that emits typed link candidates with provenance
`provider, productFamily/model, versionId, releaseId, discoveredAt,
sourceUpdatedAt, url, match, verifiedAt`.

A scheduled job should:

1. discover documented software versions once per allowed vendor scope, with a
   configurable cadence, concurrency limits and conditional requests;
2. match only canonical vendor, software platform, model family (where
   required), and exact vendor version/ID;
3. mark ambiguous/unavailable matches for review rather than asserting
   compatibility or silently replacing maintained links;
4. upsert stable provenance keys idempotently, preserving manually maintained
   links and audit history;
5. expose last successful check, stale/broken/unknown state, retries and
   link verification (HTTP HEAD/GET allowlisted vendor hosts, timeouts, no
   cross-host redirects to internal destinations, no user-provided URL fetch).
   External SSRF and outbound egress limits must be accounted for before any
   remote link validation is implemented.

This is deliberately **not** included in the current first slice: the Aruba integration branch is still in progress, Meraki's live inventory
adapter only recently merged, and the Meraki documentation BETA API tenant
entitlement has not yet been verified. A portal index is a helpful link, not full per-release
auto-discovery.

## Checks for reviewers

```bash
npx prisma migrate dev
npm run prisma:generate
npm run typecheck
npm run lint
npm test -- src/lib/firmware-release-documentation.test.ts
```

Check a FortiOS running/preferred pair, AOS-CX on different switch series,
Meraki MR vs MS, and an observed/unmatched raw firmware string. A completed
work plan must retain its original target ID when reference links are edited.

No new runtime dependencies or copied vendor code. Uses existing Prisma,
Next.js route, and UI primitives; custom logic is limited to NOC release
identity and deliberately conservative manufacturer-owned links.
