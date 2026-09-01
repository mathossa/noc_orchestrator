CREATE TABLE "DeviceImportBatch" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceImportStagedRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "mappedData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "publishedDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceImportStagedRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceImportStagedReference" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "normalizedSourceValue" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "targetId" TEXT,
    "suggestedTargetId" TEXT,
    "suggestionScore" DOUBLE PRECISION,
    "resolutionSource" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceImportStagedReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceImportBatch_profileId_idx" ON "DeviceImportBatch"("profileId");
CREATE INDEX "DeviceImportBatch_status_idx" ON "DeviceImportBatch"("status");
CREATE INDEX "DeviceImportBatch_createdAt_idx" ON "DeviceImportBatch"("createdAt");

CREATE UNIQUE INDEX "DeviceImportStagedRow_batchId_rowNumber_key" ON "DeviceImportStagedRow"("batchId", "rowNumber");
CREATE INDEX "DeviceImportStagedRow_batchId_status_idx" ON "DeviceImportStagedRow"("batchId", "status");

CREATE UNIQUE INDEX "ImportStagedRef_batch_kind_source_context_key"
ON "DeviceImportStagedReference"("batchId", "kind", "normalizedSourceValue", "contextKey");
CREATE INDEX "DeviceImportStagedReference_batchId_status_idx" ON "DeviceImportStagedReference"("batchId", "status");
CREATE INDEX "DeviceImportStagedReference_batchId_kind_idx" ON "DeviceImportStagedReference"("batchId", "kind");
CREATE INDEX "DeviceImportStagedReference_targetId_idx" ON "DeviceImportStagedReference"("targetId");

ALTER TABLE "DeviceImportStagedRow"
ADD CONSTRAINT "DeviceImportStagedRow_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "DeviceImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceImportStagedReference"
ADD CONSTRAINT "DeviceImportStagedReference_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "DeviceImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
