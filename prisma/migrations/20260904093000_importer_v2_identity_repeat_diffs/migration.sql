-- Importer v2 stable identity crosswalks and successful-source snapshots.
-- These tables deliberately do not mutate or own canonical Device records.
CREATE TABLE "ImporterV2DeviceCrosswalk" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceAdapterId" TEXT NOT NULL,
    "canonicalDeviceId" TEXT NOT NULL,
    "sourceId" TEXT,
    "normalizedSourceId" TEXT,
    "serialNumber" TEXT,
    "normalizedSerialNumber" TEXT,
    "macAddress" TEXT,
    "normalizedMacAddress" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2DeviceCrosswalk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImporterV2SourceSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceAdapterId" TEXT NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "evaluationFingerprint" TEXT NOT NULL,
    "isFullInventoryExport" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2SourceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImporterV2SourceSnapshotRow" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "canonicalDeviceId" TEXT,
    "sourceRecordKey" TEXT,
    "rowFingerprint" TEXT NOT NULL,
    "sourceId" TEXT,
    "normalizedSourceId" TEXT,
    "serialNumber" TEXT,
    "normalizedSerialNumber" TEXT,
    "macAddress" TEXT,
    "normalizedMacAddress" TEXT,
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2SourceSnapshotRow_pkey" PRIMARY KEY ("id")
);

-- The crosswalk is provider-scoped, not adapter-scoped, so a confirmed
-- provider identity survives a later XLSX -> API transport change.
CREATE UNIQUE INDEX "ImporterV2DeviceCrosswalk_provider_canonicalDeviceId_key"
ON "ImporterV2DeviceCrosswalk"("provider", "canonicalDeviceId");
CREATE INDEX "ImporterV2DeviceCrosswalk_provider_normalizedSourceId_idx"
ON "ImporterV2DeviceCrosswalk"("provider", "normalizedSourceId");
CREATE INDEX "ImporterV2DeviceCrosswalk_provider_normalizedSerialNumber_idx"
ON "ImporterV2DeviceCrosswalk"("provider", "normalizedSerialNumber");
CREATE INDEX "ImporterV2DeviceCrosswalk_provider_normalizedMacAddress_idx"
ON "ImporterV2DeviceCrosswalk"("provider", "normalizedMacAddress");
CREATE INDEX "ImporterV2DeviceCrosswalk_sourceAdapterId_idx"
ON "ImporterV2DeviceCrosswalk"("sourceAdapterId");
CREATE INDEX "ImporterV2DeviceCrosswalk_canonicalDeviceId_idx"
ON "ImporterV2DeviceCrosswalk"("canonicalDeviceId");

CREATE UNIQUE INDEX "ImporterV2SourceSnapshot_provider_sourceAdapterId_evaluationFingerprint_key"
ON "ImporterV2SourceSnapshot"("provider", "sourceAdapterId", "evaluationFingerprint");
CREATE INDEX "ImporterV2SourceSnapshot_provider_sourceAdapterId_publishedAt_idx"
ON "ImporterV2SourceSnapshot"("provider", "sourceAdapterId", "publishedAt");

CREATE UNIQUE INDEX "ImporterV2SourceSnapshotRow_snapshotId_rowNumber_key"
ON "ImporterV2SourceSnapshotRow"("snapshotId", "rowNumber");
CREATE INDEX "ImporterV2SourceSnapshotRow_snapshotId_canonicalDeviceId_idx"
ON "ImporterV2SourceSnapshotRow"("snapshotId", "canonicalDeviceId");
CREATE INDEX "ImporterV2SourceSnapshotRow_normalizedSourceId_idx"
ON "ImporterV2SourceSnapshotRow"("normalizedSourceId");
CREATE INDEX "ImporterV2SourceSnapshotRow_normalizedSerialNumber_idx"
ON "ImporterV2SourceSnapshotRow"("normalizedSerialNumber");
CREATE INDEX "ImporterV2SourceSnapshotRow_normalizedMacAddress_idx"
ON "ImporterV2SourceSnapshotRow"("normalizedMacAddress");

ALTER TABLE "ImporterV2SourceSnapshotRow"
ADD CONSTRAINT "ImporterV2SourceSnapshotRow_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "ImporterV2SourceSnapshot"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
