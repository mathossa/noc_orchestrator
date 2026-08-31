-- Issue #7 follow-up: first-class firmware trains / release families.
-- Keep train identity explicit rather than deriving it from opaque vendor version strings.

CREATE TABLE "FirmwareTrain" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalProvider" TEXT,
    "externalId" TEXT,
    "lastSynchronizedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FirmwareTrain_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FirmwareRelease"
ADD COLUMN "firmwareTrainId" TEXT;

CREATE INDEX "FirmwareTrain_vendorId_idx" ON "FirmwareTrain"("vendorId");
CREATE INDEX "FirmwareTrain_platform_idx" ON "FirmwareTrain"("platform");
CREATE INDEX "FirmwareTrain_source_idx" ON "FirmwareTrain"("source");
CREATE INDEX "FirmwareTrain_isActive_idx" ON "FirmwareTrain"("isActive");
CREATE INDEX "FirmwareTrain_externalProvider_externalId_idx" ON "FirmwareTrain"("externalProvider", "externalId");
CREATE INDEX "FirmwareRelease_firmwareTrainId_idx" ON "FirmwareRelease"("firmwareTrainId");

-- Train labels are unique within a vendor + normalized platform scope.
CREATE UNIQUE INDEX "FirmwareTrain_vendor_platform_name_normalized_key"
ON "FirmwareTrain" (
  "vendorId",
  (lower(regexp_replace(btrim("platform"), '[[:space:]]+', ' ', 'g'))),
  (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')))
);

ALTER TABLE "FirmwareTrain"
ADD CONSTRAINT "FirmwareTrain_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwareRelease"
ADD CONSTRAINT "FirmwareRelease_firmwareTrainId_fkey"
FOREIGN KEY ("firmwareTrainId") REFERENCES "FirmwareTrain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
