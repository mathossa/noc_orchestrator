-- Issue #62: durable quarterly firmware review/report history.
-- Reports keep immutable JSON snapshots so historical customer output is never
-- rebuilt from today's policy, exception, planning, or inventory state.

CREATE TABLE "FirmwareReviewCycle" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "nextReviewAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "decisionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerUserId" TEXT,
    "reviewerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmwareReviewCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwareReviewReport" (
    "id" TEXT NOT NULL,
    "reviewCycleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByUserId" TEXT,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "artifactReference" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "FirmwareReviewReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FirmwareReviewCycle_customerId_periodEnd_idx"
ON "FirmwareReviewCycle"("customerId", "periodEnd");

CREATE INDEX "FirmwareReviewCycle_state_nextReviewAt_idx"
ON "FirmwareReviewCycle"("state", "nextReviewAt");

CREATE UNIQUE INDEX "FirmwareReviewReport_reviewCycleId_version_key"
ON "FirmwareReviewReport"("reviewCycleId", "version");

CREATE INDEX "FirmwareReviewReport_status_generatedAt_idx"
ON "FirmwareReviewReport"("status", "generatedAt");

CREATE INDEX "FirmwareReviewReport_snapshotHash_idx"
ON "FirmwareReviewReport"("snapshotHash");

ALTER TABLE "FirmwareReviewReport"
ADD CONSTRAINT "FirmwareReviewReport_reviewCycleId_fkey"
FOREIGN KEY ("reviewCycleId") REFERENCES "FirmwareReviewCycle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
