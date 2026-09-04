-- Issue #43: evolve exact model targets into scoped, append-oriented policy versions.
-- Existing rows remain valid concrete-model EXACT policies and keep their history.

-- Issue #9 enforced one active exact model baseline. #43 keeps current and
-- future policy versions active together so effectiveFrom can choose the right
-- version without rewriting history.
DROP INDEX IF EXISTS "FirmwarePolicy_active_model_baseline_key";

ALTER TABLE "FirmwarePolicy"
  ALTER COLUMN "targetFirmwareReleaseId" DROP NOT NULL;

ALTER TABLE "FirmwarePolicy"
  ADD COLUMN "deviceModelFamilyId" TEXT,
  ADD COLUMN "siteId" TEXT,
  ADD COLUMN "minimumFirmwareReleaseId" TEXT,
  ADD COLUMN "maximumFirmwareReleaseId" TEXT,
  ADD COLUMN "firmwareTrainId" TEXT,
  ADD COLUMN "policyMode" TEXT NOT NULL DEFAULT 'EXACT',
  ADD COLUMN "trackKey" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "trackName" TEXT NOT NULL DEFAULT 'Default',
  ADD COLUMN "trackClass" TEXT NOT NULL DEFAULT 'PREFERRED',
  ADD COLUMN "isDefaultTrack" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "desiredPlatform" TEXT,
  ADD COLUMN "minimumInclusive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "maximumInclusive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;

-- Preserve the original policy activation time instead of pretending migrated
-- policies were created by this migration.
UPDATE "FirmwarePolicy"
SET "effectiveFrom" = "createdAt"
WHERE "effectiveFrom" IS NULL;

ALTER TABLE "FirmwarePolicy"
  ALTER COLUMN "effectiveFrom" SET NOT NULL,
  ALTER COLUMN "effectiveFrom" SET DEFAULT CURRENT_TIMESTAMP;

-- Existing exact policies already carry a canonical preferred release. Preserve
-- its platform as the explicit desired platform so observed/current platform can
-- never redefine desired state during resolution.
UPDATE "FirmwarePolicy" AS policy
SET "desiredPlatform" = release."platform"
FROM "FirmwareRelease" AS release
WHERE policy."targetFirmwareReleaseId" = release."id"
  AND policy."desiredPlatform" IS NULL;

-- Existing append history is versioned deterministically inside its legacy
-- scope. New writes continue the sequence rather than overwriting old rows.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "deviceModelId",
        "customerId",
        "contractTypeId",
        "deviceId",
        "vendorId",
        "deviceTypeId",
        "trackKey"
      ORDER BY "effectiveFrom", "createdAt", "id"
    )::INTEGER AS version
  FROM "FirmwarePolicy"
)
UPDATE "FirmwarePolicy" AS policy
SET "policyVersion" = ranked.version
FROM ranked
WHERE policy."id" = ranked."id";

ALTER TABLE "FirmwarePolicy"
  ADD CONSTRAINT "FirmwarePolicy_policyMode_check"
    CHECK ("policyMode" IN ('EXACT', 'MINIMUM', 'RANGE', 'LATEST_APPROVED_IN_TRAIN')),
  ADD CONSTRAINT "FirmwarePolicy_trackClass_check"
    CHECK ("trackClass" IN ('PREFERRED', 'ACCEPTED', 'LEGACY', 'RESTRICTED')),
  ADD CONSTRAINT "FirmwarePolicy_policyVersion_check"
    CHECK ("policyVersion" > 0),
  ADD CONSTRAINT "FirmwarePolicy_modeTargets_check"
    CHECK (
      ("policyMode" = 'EXACT' AND "targetFirmwareReleaseId" IS NOT NULL)
      OR
      ("policyMode" = 'MINIMUM' AND "minimumFirmwareReleaseId" IS NOT NULL AND "targetFirmwareReleaseId" IS NOT NULL)
      OR
      ("policyMode" = 'RANGE' AND ("minimumFirmwareReleaseId" IS NOT NULL OR "maximumFirmwareReleaseId" IS NOT NULL) AND "targetFirmwareReleaseId" IS NOT NULL)
      OR
      ("policyMode" = 'LATEST_APPROVED_IN_TRAIN' AND "firmwareTrainId" IS NOT NULL)
    );

ALTER TABLE "FirmwarePolicy"
  ADD CONSTRAINT "FirmwarePolicy_deviceModelFamilyId_fkey"
    FOREIGN KEY ("deviceModelFamilyId") REFERENCES "DeviceModelFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FirmwarePolicy_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FirmwarePolicy_minimumFirmwareReleaseId_fkey"
    FOREIGN KEY ("minimumFirmwareReleaseId") REFERENCES "FirmwareRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FirmwarePolicy_maximumFirmwareReleaseId_fkey"
    FOREIGN KEY ("maximumFirmwareReleaseId") REFERENCES "FirmwareRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FirmwarePolicy_firmwareTrainId_fkey"
    FOREIGN KEY ("firmwareTrainId") REFERENCES "FirmwareTrain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FirmwarePolicy_deviceModelFamilyId_isActive_effectiveFrom_idx"
  ON "FirmwarePolicy"("deviceModelFamilyId", "isActive", "effectiveFrom");
CREATE INDEX "FirmwarePolicy_siteId_isActive_effectiveFrom_idx"
  ON "FirmwarePolicy"("siteId", "isActive", "effectiveFrom");
CREATE INDEX "FirmwarePolicy_customerId_isActive_effectiveFrom_idx"
  ON "FirmwarePolicy"("customerId", "isActive", "effectiveFrom");
CREATE INDEX "FirmwarePolicy_deviceId_isActive_effectiveFrom_idx"
  ON "FirmwarePolicy"("deviceId", "isActive", "effectiveFrom");
CREATE INDEX "FirmwarePolicy_trackKey_isDefaultTrack_isActive_effectiveFrom_idx"
  ON "FirmwarePolicy"("trackKey", "isDefaultTrack", "isActive", "effectiveFrom");
CREATE INDEX "FirmwarePolicy_minimumFirmwareReleaseId_idx"
  ON "FirmwarePolicy"("minimumFirmwareReleaseId");
CREATE INDEX "FirmwarePolicy_maximumFirmwareReleaseId_idx"
  ON "FirmwarePolicy"("maximumFirmwareReleaseId");
CREATE INDEX "FirmwarePolicy_firmwareTrainId_idx"
  ON "FirmwarePolicy"("firmwareTrainId");
