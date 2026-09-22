-- Issue #106 follow-up: distinguish broad model platform support from the
-- model's normal catalog platform preference. Multi-platform models are not
-- guessed; single-platform models can be safely backfilled.

ALTER TABLE "DeviceModel"
  ADD COLUMN "preferredPlatform" TEXT;

UPDATE "DeviceModel"
SET "preferredPlatform" = BTRIM("platform")
WHERE "platform" IS NOT NULL
  AND BTRIM("platform") <> ''
  AND "platform" NOT LIKE '%,%'
  AND "platform" NOT LIKE '%;%';

CREATE INDEX "DeviceModel_preferredPlatform_idx"
  ON "DeviceModel"("preferredPlatform");
