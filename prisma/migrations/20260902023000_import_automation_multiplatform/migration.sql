-- Support hardware models that can run on multiple firmware platforms while
-- retaining the existing DeviceModel.platform column as the preferred/default
-- platform for backwards compatibility.
CREATE TABLE "DeviceModelPlatform" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceModelPlatform_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceModelPlatform_deviceModelId_platform_key"
ON "DeviceModelPlatform"("deviceModelId", "platform");
CREATE INDEX "DeviceModelPlatform_deviceModelId_idx" ON "DeviceModelPlatform"("deviceModelId");
CREATE INDEX "DeviceModelPlatform_platform_idx" ON "DeviceModelPlatform"("platform");

ALTER TABLE "DeviceModelPlatform"
ADD CONSTRAINT "DeviceModelPlatform_deviceModelId_fkey"
FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DeviceModelPlatform" ("id", "deviceModelId", "platform")
SELECT gen_random_uuid()::text, "id", "platform"
FROM "DeviceModel"
WHERE "platform" IS NOT NULL AND btrim("platform") <> ''
ON CONFLICT ("deviceModelId", "platform") DO NOTHING;

-- A concrete device has one observed/effective platform at a time. A model can
-- advertise several supported platforms through DeviceModelPlatform.
ALTER TABLE "Device" ADD COLUMN "platform" TEXT;
CREATE INDEX "Device_platform_idx" ON "Device"("platform");

UPDATE "Device" d
SET "platform" = COALESCE(
    (
        SELECT fr."platform"
        FROM "FirmwareRelease" fr
        WHERE fr."id" = d."currentFirmwareReleaseId"
    ),
    dm."platform"
)
FROM "DeviceModel" dm
WHERE dm."id" = d."deviceModelId"
  AND d."platform" IS NULL;

-- Model desired-firmware policy is platform-scoped when a model supports more
-- than one platform. Existing policies inherit their target release platform.
ALTER TABLE "FirmwarePolicy" ADD COLUMN "platform" TEXT;
UPDATE "FirmwarePolicy" fp
SET "platform" = fr."platform"
FROM "FirmwareRelease" fr
WHERE fr."id" = fp."targetFirmwareReleaseId"
  AND fp."platform" IS NULL;
DROP INDEX IF EXISTS "FirmwarePolicy_deviceModelId_isActive_idx";
CREATE INDEX "FirmwarePolicy_deviceModelId_platform_isActive_idx"
ON "FirmwarePolicy"("deviceModelId", "platform", "isActive");

-- Staged rows can be excluded once or ignored through a reusable import profile
-- rule without deleting the raw source evidence.
ALTER TABLE "DeviceImportStagedRow" ADD COLUMN "statusReason" TEXT;
ALTER TABLE "DeviceImportStagedRow" ADD COLUMN "statusSource" TEXT;

CREATE TABLE "DeviceImportProfileRule" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'IGNORE',
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL DEFAULT 'EQUALS',
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceImportProfileRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportProfileRule_profile_action_field_value_key"
ON "DeviceImportProfileRule"("profileId", "action", "field", "operator", "normalizedValue");
CREATE INDEX "DeviceImportProfileRule_profileId_isActive_idx"
ON "DeviceImportProfileRule"("profileId", "isActive");
CREATE INDEX "DeviceImportProfileRule_action_field_idx"
ON "DeviceImportProfileRule"("action", "field");

ALTER TABLE "DeviceImportProfileRule"
ADD CONSTRAINT "DeviceImportProfileRule_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "DeviceImportProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
