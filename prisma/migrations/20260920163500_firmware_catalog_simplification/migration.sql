-- Issue #106: train-centric firmware catalog defaults.
-- Existing releases, exact identities, device references, policy references and
-- lifecycle/work history remain in place; this only adds global catalog defaults.

ALTER TABLE "FirmwareTrain"
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN "preferredFirmwareReleaseId" TEXT,
  ADD COLUMN "minimumAcceptableFirmwareReleaseId" TEXT;

-- Preserve unambiguous legacy "preferred" intent from #56 without inventing a
-- preference where more than one release was marked PREFERRED.
WITH unique_preferred_release AS (
  SELECT "firmwareTrainId", MIN(id) AS "releaseId"
  FROM "FirmwareRelease"
  WHERE "firmwareTrainId" IS NOT NULL
    AND "isActive" = TRUE
    AND "catalogState" NOT IN ('BLOCKED', 'WITHDRAWN')
    AND "policyEligibility" = 'PREFERRED'
  GROUP BY "firmwareTrainId"
  HAVING COUNT(*) = 1
)
UPDATE "FirmwareTrain" AS train
SET "preferredFirmwareReleaseId" = source."releaseId"
FROM unique_preferred_release AS source
WHERE train.id = source."firmwareTrainId";

-- A train becomes the platform preferred train only when the legacy data points
-- to exactly one unambiguous preferred train for that vendor/platform.
WITH preferred_train_count AS (
  SELECT "vendorId", LOWER(regexp_replace(BTRIM("platform"), '\\s+', ' ', 'g')) AS platform_key, COUNT(*) AS train_count
  FROM "FirmwareTrain"
  WHERE "preferredFirmwareReleaseId" IS NOT NULL
    AND "isActive" = TRUE
  GROUP BY "vendorId", LOWER("platform")
)
UPDATE "FirmwareTrain" AS train
SET "state" = 'PREFERRED'
FROM preferred_train_count AS source
WHERE train."vendorId" = source."vendorId"
  AND LOWER(regexp_replace(BTRIM(train."platform"), '\\s+', ' ', 'g')) = source.platform_key
  AND train."preferredFirmwareReleaseId" IS NOT NULL
  AND source.train_count = 1;

-- Preferred is no longer a release status/eligibility decision in #106.
-- Its unambiguous intent has been lifted to FirmwareTrain above, so normalize
-- the exact releases back to ordinary Allowed while preserving their IDs and
-- every historical reference.
UPDATE "FirmwareRelease"
SET "policyEligibility" = 'ALLOWED',
    "status" = CASE WHEN "status" = 'RECOMMENDED' THEN 'APPROVED' ELSE "status" END
WHERE "policyEligibility" = 'PREFERRED';

ALTER TABLE "FirmwareTrain"
  ADD CONSTRAINT "FirmwareTrain_preferredFirmwareReleaseId_fkey"
    FOREIGN KEY ("preferredFirmwareReleaseId") REFERENCES "FirmwareRelease"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FirmwareTrain_minimumAcceptableFirmwareReleaseId_fkey"
    FOREIGN KEY ("minimumAcceptableFirmwareReleaseId") REFERENCES "FirmwareRelease"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FirmwareTrain_state_idx" ON "FirmwareTrain"("state");
CREATE INDEX "FirmwareTrain_preferred_release_idx" ON "FirmwareTrain"("preferredFirmwareReleaseId");
CREATE INDEX "FirmwareTrain_minimum_release_idx" ON "FirmwareTrain"("minimumAcceptableFirmwareReleaseId");

-- PostgreSQL partial uniqueness matches the domain rule: at most one active
-- globally preferred train per vendor/platform while allowing many Accepted or
-- Deprecated trains.
CREATE UNIQUE INDEX "FirmwareTrain_one_preferred_platform_idx"
  ON "FirmwareTrain"(
    "vendorId",
    LOWER(regexp_replace(BTRIM("platform"), '\\s+', ' ', 'g'))
  )
  WHERE "state" = 'PREFERRED' AND "isActive" = TRUE;
