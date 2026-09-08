# Firmware compliance and recommendations (#58)

The central technical result is derived on read. No schema migration or persisted compliance snapshot is required.

## Entry points and boundaries

- `resolveFirmwareCompliance(input)` in `src/lib/firmware-compliance.ts` is the pure domain resolver.
- `resolveFirmwareComplianceBatch(deviceIds, at)` in `src/lib/firmware-compliance-store.ts` returns a map by device ID. The single-device wrapper uses the same implementation.
- Policy candidates are indexed by scope, then passed to #43's `resolveFirmwarePolicyAt`. Precedence, tracks and effective dates remain Device > Site > Customer > Model > Family. Organizational Unit does not participate.
- Current compatibility and exact target images use #57's `evaluateFirmwareCompatibility` and `resolveCompatibleFirmwareImage`, including manual overrides and supported-platform rules. `DeviceModel.platform` is never used as compatibility evidence.
- #56's canonical comparator supplies all firmware ordering. The catalog helper evaluates the persisted, directional variant-equivalence modes. Image equivalence also requires #57 compatibility evidence.
- `resolveLatestApprovedInTrain` belongs to the policy module. The foundation previously persisted the mode without selecting a moving target. It now selects a logical target using catalog eligibility and canonical comparison, leaving exact image selection to #57.

The result includes compliance, relation to preferred, recommendation, current canonical/raw evidence, effective policy and source, track, preferred target, minimum/maximum, current compatibility provenance, target resolution, resolved exact image, and explanation.

## Derived vocabulary

Compliance: `PREFERRED`, `ACCEPTED`, `BELOW_MINIMUM`, `OUTSIDE_RANGE`, `BLOCKED_RELEASE`, `UNKNOWN_FIRMWARE`, `INCOMPATIBLE`, `NO_POLICY`, `NOT_COMPARABLE`, `COMPATIBILITY_UNRESOLVED`, `TARGET_UNRESOLVED`.

Relation: `BELOW_MINIMUM`, `AT_MINIMUM`, `BELOW_PREFERRED`, `AT_PREFERRED`, `ABOVE_PREFERRED`, `ABOVE_MAXIMUM`, `NOT_COMPARABLE`. At an exclusive minimum the relation remains AT_MINIMUM while compliance is BELOW_MINIMUM. At an exclusive maximum compliance is OUTSIDE_RANGE. Bounds are checked before preferred acceptance.

Recommendations: `NO_ACTION`, `UPDATE_RECOMMENDED`, `UPDATE_REQUIRED`, `PLATFORM_MIGRATION`, `REVIEW_REQUIRED`.

| Mode | Behavior |
| --- | --- |
| EXACT | Preferred only for the intended logical release/permitted variant with resolved compatibility. Lower mismatches require an update; other mismatches require review. |
| MINIMUM | Below lower bound requires update; accepted below preferred recommends update; preferred needs no action; accepted above preferred remains explicitly newer than preferred. |
| RANGE | Respects configured inclusive/exclusive lower and upper bounds; above or at excluded maximum requires review. |
| LATEST_APPROVED_IN_TRAIN | Moving exact logical target from active ALLOWED/PREFERRED releases, excluding blocked/withdrawn releases. Observing, importing, or verifying a newer release alone cannot move it. |

Blocked/withdrawn current exact releases win over matching policy, missing policy and compatibility. Missing canonical current evidence stays UNKNOWN_FIRMWARE even when raw evidence is present. Current incompatibility is distinct from incompatible policy intent.

Unresolved target compatibility (UNKNOWN, AMBIGUOUS or INCOMPATIBLE) remains explicit under `targetCompatibility` and requires review. Missing, unsafe, ineligible, or variant-disallowed targets are TARGET_UNRESOLVED. These cases cannot silently report normal preferred/accepted resolution. A platform change yields OUTSIDE_RANGE / NOT_COMPARABLE position / PLATFORM_MIGRATION only when current compatibility is known and #57 resolves a safe, permitted target on the desired platform.

## Consumers and performance

Device query/detail, dashboard, customer summary, model summary, vendor and contract drill-downs all consume the same resolver. Device APIs expose the full result and device UI displays it. Legacy four-bucket summaries use only a projection of that result: NO_ACTION -> CURRENT, missing firmware -> UNKNOWN, missing policy -> NO_POLICY, other recommendations -> ACTION_REQUIRED. The UI calls CURRENT “No action recommended”; it includes accepted firmware newer than preferred. There is no remaining equality-only state calculation.

Model baseline editors still show their own model baseline, while device counts and release usage reflect effective per-device policy. Existing lifecycle records and planning write rules are unchanged; this issue does not implement exceptions or planning resolution for the richer policy modes.

The batch loader performs five reads (devices/models, policy, catalog, compatibility rules, overrides), independent of device count. It indexes scope candidates, logical releases, trains, rules and overrides, and caches current/target compatibility by model and release. Catalog loading is bounded to the involved vendors, plus explicitly linked current releases. No process-wide cache can leave blocked catalog state stale across requests.

The automated 12,000-device test checks five mocked reads and all returned results. This is an in-memory integration fixture, not a PostgreSQL or browser latency benchmark.

## Local acceptance checks

Use synthetic devices and releases:

1. Minimum 17.12.5, preferred 17.15.5: running 17.12.5 is accepted/update recommended; 17.9.4 requires update; 17.15.5 is preferred.
2. Add maximum 17.15.6: running 17.15.6 is accepted/newer than preferred; 17.16.1 requires review. Exclude either boundary and verify the boundary itself is rejected.
3. Set family, customer, site and device overrides. Verify device detail policy source and target, device list, dashboard and customer/model summaries agree.
4. Support AOS-8 and AOS-10 on synthetic hardware, with effective AOS-10 policy and observed AOS-8. One compatible target yields migration; missing or multiple images yields review.
5. Block the preferred release currently running on a device. Reload: it must be actionable everywhere, including devices with historical DONE/IGNORED records; those records must remain unchanged.
6. Use an unlinked raw version, an opaque comparison, and a rebuild suffix with/without explicit variant equivalence. Inspect explanations and compatibility in detail.
7. For a moving train policy, add a newer observed/verified but unevaluated release: preferred must stay fixed. Explicitly mark it policy-eligible and verify the target changes, subject to compatibility resolution.

## Configuring policies in the UI

Open **Firmware → Models → Desired** for a model (or **Edit model → Configure desired firmware**). Both links open the existing **Desired firmware policy** section at `/models/<id>#desired-firmware-policy`; the former exact-only form has been replaced, with no additional navigation menu.

Choose Exact release, Minimum version, Approved range, or Latest approved in train. The form shows only applicable release/train fields and boundary-inclusion controls. Minimum/maximum choices follow the preferred release's platform. Save writes a new version of the same model baseline/default track through the existing desired-firmware endpoint. Reopening shows the saved mode, bounds, inclusivity and train. Clear explicitly removes the concrete-model baseline, allowing inherited policy to apply.

The existing multi-model bulk action remains an explicitly labeled exact-release shortcut. Customer/site/device overrides and the complete policy workspace remain outside this editor.
