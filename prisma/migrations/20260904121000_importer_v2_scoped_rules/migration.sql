-- CreateTable
CREATE TABLE "ImporterV2RuleBook" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeRevisionVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImporterV2RuleBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImporterV2RuleRevision" (
    "id" TEXT NOT NULL,
    "ruleBookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2RuleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImporterV2ExactMapping" (
    "id" TEXT NOT NULL,
    "mappingKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "profileId" TEXT,
    "field" TEXT NOT NULL,
    "normalizedInput" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2ExactMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImporterV2RuleBook_name_key" ON "ImporterV2RuleBook"("name");
CREATE INDEX "ImporterV2RuleBook_activeRevisionVersion_idx" ON "ImporterV2RuleBook"("activeRevisionVersion");
CREATE UNIQUE INDEX "ImporterV2RuleRevision_ruleBookId_version_key" ON "ImporterV2RuleRevision"("ruleBookId", "version");
CREATE INDEX "ImporterV2RuleRevision_ruleBookId_createdAt_idx" ON "ImporterV2RuleRevision"("ruleBookId", "createdAt");
CREATE INDEX "ImporterV2RuleRevision_createdByUserId_idx" ON "ImporterV2RuleRevision"("createdByUserId");
CREATE UNIQUE INDEX "ImporterV2ExactMapping_mappingKey_version_key" ON "ImporterV2ExactMapping"("mappingKey", "version");
CREATE INDEX "ImporterV2ExactMapping_provider_profileId_field_normalizedInput_isActive_idx" ON "ImporterV2ExactMapping"("provider", "profileId", "field", "normalizedInput", "isActive");
CREATE INDEX "ImporterV2ExactMapping_mappingKey_isActive_idx" ON "ImporterV2ExactMapping"("mappingKey", "isActive");
CREATE INDEX "ImporterV2ExactMapping_createdByUserId_idx" ON "ImporterV2ExactMapping"("createdByUserId");

-- AddForeignKey
ALTER TABLE "ImporterV2RuleRevision" ADD CONSTRAINT "ImporterV2RuleRevision_ruleBookId_fkey" FOREIGN KEY ("ruleBookId") REFERENCES "ImporterV2RuleBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
