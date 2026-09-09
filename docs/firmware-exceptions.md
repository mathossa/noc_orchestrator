# Firmware exceptions (#59)

Open **Firmware → Exceptions**. Devices, customers, sites, and models also link
there with the scope preselected; choose Family for a family-wide decision.

Exceptions are separate from the central technical compliance result. An active,
applicable exception yields `ACCEPTED_EXCEPTION` operationally while retaining the
original compliance and recommendation. Planning and completion remain separate.

## Coverage and review

- Scope precedence: Device → Site → Customer → Model → Family. At equal scope,
  the newest active matching decision wins; all matching records remain visible.
- Coverage: exact target/build, inclusive version range within one vendor/platform,
  firmware train, specific platform migration, all maintenance, or temporary hold.
- Duration: next quarterly review (three calendar months), custom date, known EOL
  date, permanent, or until the effective policy/target changes. Unknown EOL is
  not silently interpreted as permanent.
- Until-policy-change decisions store a per-device policy/target fingerprint.
  A changed policy or target requires review for that device. Newly added devices
  are not covered by the old snapshot. Other durations also apply to new devices
  matching the selected scope and subject.
- Expired and ended decisions stay in history. Ending an exception records who
  ended it, without deleting the decision or rewriting technical state.
- Review filters include expiring before next quarter, expired/policy changed,
  permanent, customer declined, platform holds, and replacement/EOL reasons.
- Administrators can add reason codes, including a replacement-follow-up flag.
  Other requires notes.

Preview lists all currently affected devices and the total scope count. Saving
rechecks the input, scope membership, effective policy/target fingerprints, and
covered recommendation IDs in a serializable transaction. Stale previews receive
409 and must be refreshed. Creation and ending each write an audit event in the
same transaction as the exception. All API access requires a signed-in session.

## Migration and #51 boundary

`20260909130000_firmware_exceptions` copies existing IGNORED and CUSTOMER_DECLINED
records into device-scoped, exact-target exceptions. The complete original row is
preserved in `legacyEvidence` (including actor, reason, notes and timestamps), and
existing audit events remain untouched. An existing review date is retained;
records without one retain indefinite exact-target coverage. Only after copying
are these exception rows removed from the old planning projection. PLANNED/DONE
records are unchanged. New declines use the exception endpoint/workspace.

Scope/actor/catalog IDs and labels are historical references, not cascading
relations. Scope and catalog references are validated when creating a decision;
removing inventory later must not erase decision evidence.

No importer files or publication writes are changed. #51 must continue to update
observed inventory only; it must not replace or delete FirmwareException records.
After integrating both branches, publish a changed inventory batch against a
device with an exception and confirm the decision/history survives. Observation
changes can legitimately affect whether its subject matches the recommendation.

## Validation

Run the usual `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
For database transaction tests, use a disposable database with all migrations
applied, then run:

```bash
EXCEPTION_TEST_DATABASE_URL='postgresql://…' npx vitest run src/lib/firmware-exception-store.integration.test.ts
```

The integration suite creates uniquely named fixtures and removes them afterward.
It verifies audit-failure rollback, observed-inventory ownership protection,
end/history behavior, and preservation of the underlying technical result.
It is opt-in and does not add a GitHub Actions workflow.

For visual validation, create a customer/site exception, inspect its device list,
then add a more specific device exception. Confirm both remain visible and the
device decision takes precedence. End it and verify the broader exception applies
again. Use a short custom expiry to check review/reactivation behavior. For
until-policy-change coverage, change the preferred target and confirm review is
required. Also check the migrated legacy records and retained Planned/Done state.
