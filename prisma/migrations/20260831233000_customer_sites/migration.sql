-- Issue #24: first-class customer sites/locations before device inventory CRUD.

CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalProvider" TEXT,
    "externalId" TEXT,
    "lastSynchronizedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Device"
ADD COLUMN "siteId" TEXT;

CREATE UNIQUE INDEX "Site_customerId_code_key" ON "Site"("customerId", "code");
CREATE UNIQUE INDEX "Site_customer_name_normalized_key"
ON "Site" (
  "customerId",
  (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')))
);
CREATE INDEX "Site_customerId_idx" ON "Site"("customerId");
CREATE INDEX "Site_name_idx" ON "Site"("name");
CREATE INDEX "Site_source_idx" ON "Site"("source");
CREATE INDEX "Site_isActive_idx" ON "Site"("isActive");
CREATE INDEX "Site_externalProvider_externalId_idx" ON "Site"("externalProvider", "externalId");
CREATE INDEX "Device_siteId_idx" ON "Device"("siteId");

ALTER TABLE "Site"
ADD CONSTRAINT "Site_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device"
ADD CONSTRAINT "Device_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
