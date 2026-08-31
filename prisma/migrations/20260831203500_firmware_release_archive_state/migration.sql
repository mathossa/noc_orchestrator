-- Issue #7: keep catalog status separate from archive state.
ALTER TABLE "FirmwareRelease"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "FirmwareRelease_isActive_idx" ON "FirmwareRelease"("isActive");

-- Platform/family is normalized for catalog identity while version remains an
-- opaque vendor string and is therefore compared exactly.
CREATE UNIQUE INDEX "FirmwareRelease_vendor_platform_normalized_version_key"
ON "FirmwareRelease" (
  "vendorId",
  lower(regexp_replace(btrim("platform"), '[[:space:]]+', ' ', 'g')),
  "version"
);
