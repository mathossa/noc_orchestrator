-- Existing sites remain ungrouped. No source names are parsed or rewritten.
CREATE TABLE "CustomerOrganizationUnit" (
 "id" TEXT NOT NULL, "customerId" TEXT NOT NULL, "parentId" TEXT,
 "name" TEXT NOT NULL, "code" TEXT, "notes" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
 "source" TEXT NOT NULL DEFAULT 'MANUAL', "externalProvider" TEXT, "externalId" TEXT,
 "lastSynchronizedAt" TIMESTAMP(3), "sourceMetadata" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CustomerOrganizationUnit_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "CustomerOrganizationUnit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CustomerOrganizationUnit_not_self_parent" CHECK ("parentId" IS DISTINCT FROM "id")
);
CREATE UNIQUE INDEX "CustomerOrganizationUnit_id_customerId_key" ON "CustomerOrganizationUnit"("id", "customerId");
ALTER TABLE "CustomerOrganizationUnit" ADD CONSTRAINT "CustomerOrganizationUnit_parentId_customerId_fkey" FOREIGN KEY ("parentId", "customerId") REFERENCES "CustomerOrganizationUnit"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CustomerOrganizationUnit_customerId_parentId_idx" ON "CustomerOrganizationUnit"("customerId", "parentId");
CREATE INDEX "CustomerOrganizationUnit_externalProvider_externalId_idx" ON "CustomerOrganizationUnit"("externalProvider", "externalId");
CREATE INDEX "CustomerOrganizationUnit_isActive_idx" ON "CustomerOrganizationUnit"("isActive");
CREATE INDEX "CustomerOrganizationUnit_name_idx" ON "CustomerOrganizationUnit"("name");
CREATE UNIQUE INDEX "organization_unit_root_name" ON "CustomerOrganizationUnit"("customerId", lower("name")) WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "organization_unit_child_name" ON "CustomerOrganizationUnit"("customerId", "parentId", lower("name")) WHERE "parentId" IS NOT NULL;
CREATE UNIQUE INDEX "organization_unit_root_code" ON "CustomerOrganizationUnit"("customerId", "code") WHERE "parentId" IS NULL AND "code" IS NOT NULL;
CREATE UNIQUE INDEX "organization_unit_child_code" ON "CustomerOrganizationUnit"("customerId", "parentId", "code") WHERE "parentId" IS NOT NULL AND "code" IS NOT NULL;
ALTER TABLE "Site" ADD COLUMN "organizationUnitId" TEXT;
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationUnitId_customerId_fkey" FOREIGN KEY ("organizationUnitId", "customerId") REFERENCES "CustomerOrganizationUnit"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Site_customerId_organizationUnitId_idx" ON "Site"("customerId", "organizationUnitId");
DROP INDEX "Site_customerId_code_key";
CREATE UNIQUE INDEX "site_ungrouped_code" ON "Site"("customerId", "code") WHERE "organizationUnitId" IS NULL AND "code" IS NOT NULL;
CREATE UNIQUE INDEX "site_unit_code" ON "Site"("customerId", "organizationUnitId", "code") WHERE "organizationUnitId" IS NOT NULL AND "code" IS NOT NULL;
DROP INDEX "Site_customer_name_normalized_key";
CREATE UNIQUE INDEX "site_ungrouped_name" ON "Site"("customerId", (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')))) WHERE "organizationUnitId" IS NULL;
CREATE UNIQUE INDEX "site_unit_name" ON "Site"("customerId", "organizationUnitId", (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')))) WHERE "organizationUnitId" IS NOT NULL;
