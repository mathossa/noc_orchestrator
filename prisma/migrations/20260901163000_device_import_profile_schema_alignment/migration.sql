-- Align the profile tables with the Prisma schema after the initial profile migration.
-- This migration is intentionally idempotent for development databases that may
-- already contain these adjustments from an earlier local-only migration.

ALTER TABLE "DeviceImportProfile"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "DeviceImportProfileAlias"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF to_regclass('"DeviceImportProfileAlias_profileId_kind_normalizedSourceValue_c"') IS NOT NULL
     AND to_regclass('"DeviceImportProfileAlias_profileId_kind_normalizedSourceVal_key"') IS NULL THEN
    ALTER INDEX "DeviceImportProfileAlias_profileId_kind_normalizedSourceValue_c"
      RENAME TO "DeviceImportProfileAlias_profileId_kind_normalizedSourceVal_key";
  END IF;
END $$;
