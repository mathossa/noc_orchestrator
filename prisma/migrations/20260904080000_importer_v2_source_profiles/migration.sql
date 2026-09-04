-- Issue #46: persist confirmed source-profile parsing policy independently
-- from temporary import batches and canonical inventory records.
CREATE TABLE "ImporterV2SourceProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "schemaFingerprint" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceAdapterId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "headers" JSONB NOT NULL,
    "columnMappings" JSONB NOT NULL,
    "hierarchyTemplate" JSONB NOT NULL,
    "deviceTypePolicy" JSONB NOT NULL,
    "defaults" JSONB NOT NULL,
    "exactValueAliases" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2SourceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImporterV2SourceProfile_provider_name_key"
ON "ImporterV2SourceProfile"("provider", "name");

CREATE INDEX "ImporterV2SourceProfile_sourceAdapterId_provider_schemaFingerprint_isActive_idx"
ON "ImporterV2SourceProfile"("sourceAdapterId", "provider", "schemaFingerprint", "isActive");

CREATE INDEX "ImporterV2SourceProfile_isActive_name_idx"
ON "ImporterV2SourceProfile"("isActive", "name");
