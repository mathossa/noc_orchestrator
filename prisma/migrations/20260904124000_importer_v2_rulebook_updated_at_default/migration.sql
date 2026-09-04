-- Integration correction after merged Issue #49.
-- ImporterV2RuleBook.updatedAt is declared as @default(now()) @updatedAt in the
-- Prisma schema, but the original #49 migration created the column without the
-- database default. Without this correction, `prisma migrate dev` immediately
-- generates another migration after applying the repository migrations.
ALTER TABLE "ImporterV2RuleBook"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
