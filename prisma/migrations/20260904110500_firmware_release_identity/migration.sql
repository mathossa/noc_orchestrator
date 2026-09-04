-- Issue #56 separates exact firmware identity, catalog verification, and policy
-- eligibility while preserving the Issue #7 status field for compatibility.

ALTER TABLE "FirmwareRelease"
ADD COLUMN "logicalVersion" TEXT,
ADD COLUMN "variant" TEXT,
ADD COLUMN "imageCode" TEXT,
ADD COLUMN "catalogState" TEXT NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN "policyEligibility" TEXT NOT NULL DEFAULT 'NOT_EVALUATED',
ADD COLUMN "variantEquivalence" TEXT NOT NULL DEFAULT 'EXACT_ONLY';

-- Every existing exact release remains valid. Start with exact=logical and then
-- enrich deterministic syntaxes without changing the exact version string.
UPDATE "FirmwareRelease"
SET "logicalVersion" = "version";

-- Aruba AOS-S style software-image prefixes such as WC.16.11.0002.
UPDATE "FirmwareRelease"
SET
  "imageCode" = upper(regexp_replace("version", '^([A-Za-z]{1,8})\..*$', '\1')),
  "logicalVersion" = regexp_replace("version", '^[A-Za-z]{1,8}\.', '')
WHERE "version" ~ '^[A-Za-z]{1,8}\.[0-9]+(\.[0-9]+){2,}([A-Za-z][A-Za-z0-9._-]*)?$';

-- Cisco IOS style maintenance rebuilds such as 15.2(7)E17a. The suffix is a
-- variant; ordering between suffixes is deliberately not inferred.
UPDATE "FirmwareRelease"
SET
  "logicalVersion" = regexp_replace(
    "version",
    '^([0-9]+\.[0-9]+\([0-9]+\)[A-Za-z]+[0-9]+)([A-Za-z]+)$',
    '\1'
  ),
  "variant" = regexp_replace(
    "version",
    '^([0-9]+\.[0-9]+\([0-9]+\)[A-Za-z]+[0-9]+)([A-Za-z]+)$',
    '\2'
  )
WHERE "version" ~ '^[0-9]+\.[0-9]+\([0-9]+\)[A-Za-z]+[0-9]+[A-Za-z]+$';

-- Migrate the overloaded Issue #7 status into independent dimensions. Keep the
-- old status unchanged so existing UI/audit history remains readable.
UPDATE "FirmwareRelease"
SET
  "catalogState" = CASE
    WHEN upper("status") = 'BLOCKED' THEN 'BLOCKED'
    ELSE 'VERIFIED'
  END,
  "policyEligibility" = CASE
    WHEN upper("status") = 'RECOMMENDED' THEN 'PREFERRED'
    WHEN upper("status") = 'APPROVED' THEN 'ALLOWED'
    WHEN upper("status") IN ('DEPRECATED', 'BLOCKED') THEN 'DISALLOWED'
    ELSE 'NOT_EVALUATED'
  END;

ALTER TABLE "FirmwareRelease"
ALTER COLUMN "logicalVersion" SET NOT NULL;

ALTER TABLE "FirmwareRelease"
ADD CONSTRAINT "FirmwareRelease_catalogState_check"
CHECK ("catalogState" IN ('OBSERVED', 'VERIFIED', 'BLOCKED', 'WITHDRAWN')),
ADD CONSTRAINT "FirmwareRelease_policyEligibility_check"
CHECK ("policyEligibility" IN ('NOT_EVALUATED', 'ALLOWED', 'PREFERRED', 'DISALLOWED')),
ADD CONSTRAINT "FirmwareRelease_variantEquivalence_check"
CHECK ("variantEquivalence" IN ('EXACT_ONLY', 'ANY_VERIFIED_VARIANT', 'ANY_NON_BLOCKED_VARIANT'));

CREATE INDEX "FirmwareRelease_logicalVersion_idx" ON "FirmwareRelease"("logicalVersion");
CREATE INDEX "FirmwareRelease_catalogState_idx" ON "FirmwareRelease"("catalogState");
CREATE INDEX "FirmwareRelease_policyEligibility_idx" ON "FirmwareRelease"("policyEligibility");

-- Preserve source evidence independently from the optional canonical release
-- link. Importer v2 can later publish raw/interpreted evidence even when the
-- release cannot safely be linked because compatibility is unknown/conflicting.
ALTER TABLE "Device"
ADD COLUMN "currentFirmwareRawVersion" TEXT,
ADD COLUMN "currentFirmwareNormalizedVersion" TEXT,
ADD COLUMN "currentFirmwareEvidence" JSONB,
ADD COLUMN "currentFirmwareInterpreterId" TEXT,
ADD COLUMN "currentFirmwareInterpreterVersion" TEXT;

-- Existing linked current-firmware records gain a lossless baseline observation.
UPDATE "Device" AS d
SET
  "currentFirmwareRawVersion" = f."version",
  "currentFirmwareNormalizedVersion" = f."version"
FROM "FirmwareRelease" AS f
WHERE d."currentFirmwareReleaseId" = f."id";
