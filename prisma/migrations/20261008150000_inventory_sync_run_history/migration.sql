CREATE TABLE "InventorySyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "batchId" TEXT,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "stagedCount" INTEGER NOT NULL DEFAULT 0,
    "autoPublishedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewRequiredCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "failureSummary" JSONB,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "InventorySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventorySyncRun_sourceId_startedAt_idx" ON "InventorySyncRun"("sourceId", "startedAt");
CREATE INDEX "InventorySyncRun_sourceId_status_idx" ON "InventorySyncRun"("sourceId", "status");
CREATE INDEX "InventorySyncRun_status_startedAt_idx" ON "InventorySyncRun"("status", "startedAt");

ALTER TABLE "InventorySyncRun"
ADD CONSTRAINT "InventorySyncRun_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "InventorySource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
