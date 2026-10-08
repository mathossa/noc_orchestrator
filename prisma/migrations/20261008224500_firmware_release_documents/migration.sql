CREATE TABLE "FirmwareReleaseDocument" (
    "id" TEXT NOT NULL,
    "firmwareReleaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "match" TEXT NOT NULL DEFAULT 'EXACT_VERSION',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FirmwareReleaseDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirmwareReleaseDocument_firmwareReleaseId_url_key"
ON "FirmwareReleaseDocument"("firmwareReleaseId", "url");

CREATE INDEX "FirmwareReleaseDocument_firmwareReleaseId_type_idx"
ON "FirmwareReleaseDocument"("firmwareReleaseId", "type");

ALTER TABLE "FirmwareReleaseDocument"
ADD CONSTRAINT "FirmwareReleaseDocument_firmwareReleaseId_fkey"
FOREIGN KEY ("firmwareReleaseId") REFERENCES "FirmwareRelease"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
