-- Normalize the PostgreSQL-truncated importer workspace index name to the
-- identifier Prisma expects. No index definition changes.
ALTER INDEX "ImporterV2WorkspaceRow_batchId_repeatClassification_rowNumber_i"
  RENAME TO "ImporterV2WorkspaceRow_batchId_repeatClassification_rowNumb_idx";
