-- Make the hierarchy explicit without breaking existing string-based platform
-- lookups. DeviceModelFamily is the existing Product Family entity.
CREATE TABLE "SoftwarePlatform" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productFamilyId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftwarePlatform_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SoftwarePlatform_vendorId_code_key" ON "SoftwarePlatform"("vendorId", "code");
CREATE INDEX "SoftwarePlatform_vendorId_idx" ON "SoftwarePlatform"("vendorId");
CREATE INDEX "SoftwarePlatform_productFamilyId_idx" ON "SoftwarePlatform"("productFamilyId");
CREATE INDEX "SoftwarePlatform_isActive_idx" ON "SoftwarePlatform"("isActive");

ALTER TABLE "SoftwarePlatform" ADD CONSTRAINT "SoftwarePlatform_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SoftwarePlatform" ADD CONSTRAINT "SoftwarePlatform_productFamilyId_fkey"
FOREIGN KEY ("productFamilyId") REFERENCES "DeviceModelFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceModelPlatform" ADD COLUMN "softwarePlatformId" TEXT;
ALTER TABLE "FirmwareTrain" ADD COLUMN "softwarePlatformId" TEXT;
ALTER TABLE "FirmwareRelease" ADD COLUMN "softwarePlatformId" TEXT;
ALTER TABLE "DeviceImportProfileRule" ADD COLUMN "result" JSONB;
ALTER TABLE "DeviceImportProfileRule" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX "DeviceModelPlatform_softwarePlatformId_idx" ON "DeviceModelPlatform"("softwarePlatformId");
CREATE INDEX "FirmwareTrain_softwarePlatformId_idx" ON "FirmwareTrain"("softwarePlatformId");
CREATE INDEX "FirmwareRelease_softwarePlatformId_idx" ON "FirmwareRelease"("softwarePlatformId");

ALTER TABLE "DeviceModelPlatform" ADD CONSTRAINT "DeviceModelPlatform_softwarePlatformId_fkey"
FOREIGN KEY ("softwarePlatformId") REFERENCES "SoftwarePlatform"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FirmwareTrain" ADD CONSTRAINT "FirmwareTrain_softwarePlatformId_fkey"
FOREIGN KEY ("softwarePlatformId") REFERENCES "SoftwarePlatform"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FirmwareRelease" ADD CONSTRAINT "FirmwareRelease_softwarePlatformId_fkey"
FOREIGN KEY ("softwarePlatformId") REFERENCES "SoftwarePlatform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill one catalog entry per Vendor + legacy platform string. Family links
-- are filled where all existing Models for the platform agree on one family.
INSERT INTO "SoftwarePlatform" ("id", "vendorId", "productFamilyId", "code", "name")
SELECT
    gen_random_uuid()::text,
    source."vendorId",
    CASE WHEN COUNT(DISTINCT source."familyId") FILTER (WHERE source."familyId" IS NOT NULL) = 1
         THEN MIN(source."familyId") ELSE NULL END,
    upper(regexp_replace(btrim(source."platform"), '[^A-Za-z0-9]+', '-', 'g')),
    btrim(source."platform")
FROM (
    SELECT dm."vendorId", dm."familyId", dmp."platform"
    FROM "DeviceModelPlatform" dmp
    JOIN "DeviceModel" dm ON dm."id" = dmp."deviceModelId"
    UNION ALL
    SELECT ft."vendorId", NULL::text AS "familyId", ft."platform" FROM "FirmwareTrain" ft
    UNION ALL
    SELECT fr."vendorId", NULL::text AS "familyId", fr."platform" FROM "FirmwareRelease" fr
) source
WHERE btrim(source."platform") <> ''
GROUP BY source."vendorId", upper(regexp_replace(btrim(source."platform"), '[^A-Za-z0-9]+', '-', 'g')), btrim(source."platform")
ON CONFLICT ("vendorId", "code") DO NOTHING;

UPDATE "DeviceModelPlatform" dmp
SET "softwarePlatformId" = sp."id"
FROM "DeviceModel" dm, "SoftwarePlatform" sp
WHERE dm."id" = dmp."deviceModelId"
  AND sp."vendorId" = dm."vendorId"
  AND sp."code" = upper(regexp_replace(btrim(dmp."platform"), '[^A-Za-z0-9]+', '-', 'g'));

UPDATE "FirmwareTrain" ft
SET "softwarePlatformId" = sp."id"
FROM "SoftwarePlatform" sp
WHERE sp."vendorId" = ft."vendorId"
  AND sp."code" = upper(regexp_replace(btrim(ft."platform"), '[^A-Za-z0-9]+', '-', 'g'));

UPDATE "FirmwareRelease" fr
SET "softwarePlatformId" = sp."id"
FROM "SoftwarePlatform" sp
WHERE sp."vendorId" = fr."vendorId"
  AND sp."code" = upper(regexp_replace(btrim(fr."platform"), '[^A-Za-z0-9]+', '-', 'g'));
