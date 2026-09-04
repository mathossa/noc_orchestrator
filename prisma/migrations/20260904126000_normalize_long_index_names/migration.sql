-- Normalize PostgreSQL-truncated index names to the identifiers Prisma expects.
-- No index definitions change; this migration only renames existing indexes so
-- `prisma migrate dev` sees the reconstructed database schema as migration-clean.

ALTER INDEX "FirmwarePolicy_trackKey_isDefaultTrack_isActive_effectiveFrom_i"
  RENAME TO "FirmwarePolicy_trackKey_isDefaultTrack_isActive_effectiveFr_idx";

ALTER INDEX "ImporterV2ExactMapping_provider_profileId_field_normalizedInput"
  RENAME TO "ImporterV2ExactMapping_provider_profileId_field_normalizedI_idx";

ALTER INDEX "ImporterV2SourceProfile_sourceAdapterId_provider_schemaFingerpr"
  RENAME TO "ImporterV2SourceProfile_sourceAdapterId_provider_schemaFing_idx";

ALTER INDEX "ImporterV2SourceSnapshot_provider_sourceAdapterId_evaluationFin"
  RENAME TO "ImporterV2SourceSnapshot_provider_sourceAdapterId_evaluatio_key";

ALTER INDEX "ImporterV2SourceSnapshot_provider_sourceAdapterId_publishedAt_i"
  RENAME TO "ImporterV2SourceSnapshot_provider_sourceAdapterId_published_idx";
