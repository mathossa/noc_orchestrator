-- Issue #7: keep catalog status separate from archive state.
ALTER TABLE "FirmwareRelease"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "FirmwareRelease_isActive_idx" ON "FirmwareRelease"("isActive");
