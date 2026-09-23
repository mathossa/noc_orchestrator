-- CreateTable
CREATE TABLE "InventorySource" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "sourceAdapterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySyncProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySyncProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySyncProfileSource" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySyncProfileSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventorySource_provider_sourceAdapterId_key" ON "InventorySource"("provider", "sourceAdapterId");
CREATE INDEX "InventorySource_provider_enabled_idx" ON "InventorySource"("provider", "enabled");
CREATE INDEX "InventorySource_adapterType_enabled_idx" ON "InventorySource"("adapterType", "enabled");
CREATE INDEX "InventorySource_name_idx" ON "InventorySource"("name");
CREATE UNIQUE INDEX "InventorySyncProfile_name_key" ON "InventorySyncProfile"("name");
CREATE INDEX "InventorySyncProfile_enabled_name_idx" ON "InventorySyncProfile"("enabled", "name");
CREATE UNIQUE INDEX "InventorySyncProfileSource_profileId_sourceId_key" ON "InventorySyncProfileSource"("profileId", "sourceId");
CREATE INDEX "InventorySyncProfileSource_profileId_position_idx" ON "InventorySyncProfileSource"("profileId", "position");
CREATE INDEX "InventorySyncProfileSource_sourceId_idx" ON "InventorySyncProfileSource"("sourceId");

ALTER TABLE "InventorySyncProfileSource" ADD CONSTRAINT "InventorySyncProfileSource_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "InventorySyncProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventorySyncProfileSource" ADD CONSTRAINT "InventorySyncProfileSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "InventorySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
