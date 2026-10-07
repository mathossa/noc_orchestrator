ALTER TABLE "ImporterV2DeviceCrosswalk"
ADD COLUMN "rawSourceId" TEXT,
ADD COLUMN "rawSerialNumber" TEXT,
ADD COLUMN "rawMacAddress" TEXT,
ADD COLUMN "sourceIdEvidenceState" TEXT,
ADD COLUMN "serialNumberEvidenceState" TEXT,
ADD COLUMN "macAddressEvidenceState" TEXT;

UPDATE "ImporterV2DeviceCrosswalk"
SET
  "rawSourceId" = "sourceId",
  "rawSerialNumber" = "serialNumber",
  "rawMacAddress" = "macAddress",
  "sourceIdEvidenceState" = CASE WHEN "sourceId" IS NULL THEN NULL ELSE 'ACCEPTED' END,
  "serialNumberEvidenceState" = CASE WHEN "serialNumber" IS NULL THEN NULL ELSE 'ACCEPTED' END,
  "macAddressEvidenceState" = CASE WHEN "macAddress" IS NULL THEN NULL ELSE 'ACCEPTED' END;
