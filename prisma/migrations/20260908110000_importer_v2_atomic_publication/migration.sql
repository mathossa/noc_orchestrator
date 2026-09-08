-- Issue #51: explicit QA publication boundary, idempotency, and partial-publication tracking.
ALTER TABLE "ImporterV2WorkspaceBatch"
ADD COLUMN "publishedRowCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ImporterV2WorkspaceRow"
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "publicationAttemptId" TEXT;

ALTER TABLE "ImporterV2SourceSnapshot"
ADD COLUMN "publicationAttemptId" TEXT;

DROP INDEX "ImporterV2SourceSnapshot_provider_sourceAdapterId_evaluationFingerprint_key";

CREATE TABLE "ImporterV2PublicationAttempt" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "qaFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMMITTING',
    "approvedProposalKeys" TEXT[],
    "actorUserId" TEXT,
    "sourceMetadata" JSONB NOT NULL,
    "counts" JSONB,
    "result" JSONB,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImporterV2PublicationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImporterV2PublicationAttempt_batchId_idempotencyKey_key"
ON "ImporterV2PublicationAttempt"("batchId", "idempotencyKey");
CREATE INDEX "ImporterV2PublicationAttempt_batchId_publishedAt_idx"
ON "ImporterV2PublicationAttempt"("batchId", "publishedAt");
CREATE INDEX "ImporterV2PublicationAttempt_qaFingerprint_idx"
ON "ImporterV2PublicationAttempt"("qaFingerprint");
CREATE INDEX "ImporterV2PublicationAttempt_actorUserId_idx"
ON "ImporterV2PublicationAttempt"("actorUserId");
CREATE INDEX "ImporterV2PublicationAttempt_status_idx"
ON "ImporterV2PublicationAttempt"("status");

CREATE INDEX "ImporterV2WorkspaceRow_batchId_publishedAt_idx"
ON "ImporterV2WorkspaceRow"("batchId", "publishedAt");
CREATE INDEX "ImporterV2WorkspaceRow_publicationAttemptId_idx"
ON "ImporterV2WorkspaceRow"("publicationAttemptId");

CREATE UNIQUE INDEX "ImporterV2SourceSnapshot_publicationAttemptId_key"
ON "ImporterV2SourceSnapshot"("publicationAttemptId");
CREATE INDEX "ImporterV2SourceSnapshot_provider_sourceAdapterId_evaluationFingerprint_idx"
ON "ImporterV2SourceSnapshot"("provider", "sourceAdapterId", "evaluationFingerprint");

ALTER TABLE "ImporterV2PublicationAttempt"
ADD CONSTRAINT "ImporterV2PublicationAttempt_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "ImporterV2WorkspaceBatch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
