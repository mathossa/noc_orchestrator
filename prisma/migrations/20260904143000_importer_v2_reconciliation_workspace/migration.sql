-- CreateTable
CREATE TABLE "ImporterV2WorkspaceBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceAdapterId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "ruleBookId" TEXT,
    "evaluationFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECONCILING',
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2WorkspaceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImporterV2WorkspaceRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "inclusion" TEXT NOT NULL,
    "statuses" TEXT[],
    "primaryStatus" TEXT NOT NULL,
    "repeatClassification" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "hasErrors" BOOLEAN NOT NULL DEFAULT false,
    "needsReevaluation" BOOLEAN NOT NULL DEFAULT false,
    "reviewRevision" INTEGER NOT NULL DEFAULT 0,
    "sourceName" TEXT,
    "hostname" TEXT,
    "customer" TEXT,
    "businessUnit" TEXT,
    "site" TEXT,
    "vendor" TEXT,
    "deviceType" TEXT,
    "sourceModel" TEXT,
    "canonicalModel" TEXT,
    "productFamily" TEXT,
    "softwarePlatform" TEXT,
    "firmwareEvidencePattern" TEXT,
    "rawFirmwareVersion" TEXT,
    "rawSoftwareVersion" TEXT,
    "interpretedFirmware" TEXT,
    "confidence" TEXT,
    "evaluated" JSONB NOT NULL,
    "identityResolution" JSONB,
    "alternatives" JSONB,
    "repeatDiff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2WorkspaceRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImporterV2WorkspaceDecision" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "action" TEXT NOT NULL,
    "value" JSONB,
    "explanation" TEXT NOT NULL,
    "scopeToken" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2WorkspaceDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImporterV2WorkspaceBatch_evaluationFingerprint_key" ON "ImporterV2WorkspaceBatch"("evaluationFingerprint");
CREATE INDEX "ImporterV2WorkspaceBatch_status_updatedAt_idx" ON "ImporterV2WorkspaceBatch"("status", "updatedAt");
CREATE INDEX "ImporterV2WorkspaceBatch_provider_sourceAdapterId_updatedAt_idx" ON "ImporterV2WorkspaceBatch"("provider", "sourceAdapterId", "updatedAt");
CREATE INDEX "ImporterV2WorkspaceBatch_profileId_updatedAt_idx" ON "ImporterV2WorkspaceBatch"("profileId", "updatedAt");
CREATE UNIQUE INDEX "ImporterV2WorkspaceRow_batchId_rowNumber_key" ON "ImporterV2WorkspaceRow"("batchId", "rowNumber");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_rowNumber_idx" ON "ImporterV2WorkspaceRow"("batchId", "rowNumber");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_primaryStatus_rowNumber_idx" ON "ImporterV2WorkspaceRow"("batchId", "primaryStatus", "rowNumber");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_repeatClassification_rowNumber_idx" ON "ImporterV2WorkspaceRow"("batchId", "repeatClassification", "rowNumber");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_customer_businessUnit_site_idx" ON "ImporterV2WorkspaceRow"("batchId", "customer", "businessUnit", "site");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_vendor_deviceType_idx" ON "ImporterV2WorkspaceRow"("batchId", "vendor", "deviceType");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_sourceModel_idx" ON "ImporterV2WorkspaceRow"("batchId", "sourceModel");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_canonicalModel_idx" ON "ImporterV2WorkspaceRow"("batchId", "canonicalModel");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_firmwareEvidencePattern_idx" ON "ImporterV2WorkspaceRow"("batchId", "firmwareEvidencePattern");
CREATE INDEX "ImporterV2WorkspaceRow_batchId_hasErrors_issueCount_idx" ON "ImporterV2WorkspaceRow"("batchId", "hasErrors", "issueCount");
CREATE INDEX "ImporterV2WorkspaceDecision_batchId_rowNumber_createdAt_idx" ON "ImporterV2WorkspaceDecision"("batchId", "rowNumber", "createdAt");
CREATE INDEX "ImporterV2WorkspaceDecision_rowId_field_createdAt_idx" ON "ImporterV2WorkspaceDecision"("rowId", "field", "createdAt");
CREATE INDEX "ImporterV2WorkspaceDecision_scopeToken_idx" ON "ImporterV2WorkspaceDecision"("scopeToken");
CREATE INDEX "ImporterV2WorkspaceDecision_actorUserId_idx" ON "ImporterV2WorkspaceDecision"("actorUserId");

ALTER TABLE "ImporterV2WorkspaceRow" ADD CONSTRAINT "ImporterV2WorkspaceRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImporterV2WorkspaceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImporterV2WorkspaceDecision" ADD CONSTRAINT "ImporterV2WorkspaceDecision_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImporterV2WorkspaceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImporterV2WorkspaceDecision" ADD CONSTRAINT "ImporterV2WorkspaceDecision_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ImporterV2WorkspaceRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
