CREATE TABLE "DeviceImportProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalProvider" TEXT,
    "settings" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceImportProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceImportProfileAlias" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "normalizedSourceValue" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceImportProfileAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceImportProfile_name_key" ON "DeviceImportProfile"("name");
CREATE INDEX "DeviceImportProfile_isActive_idx" ON "DeviceImportProfile"("isActive");
CREATE INDEX "DeviceImportProfile_externalProvider_idx" ON "DeviceImportProfile"("externalProvider");
CREATE UNIQUE INDEX "DeviceImportProfileAlias_profileId_kind_normalizedSourceValue_contextKey_key" ON "DeviceImportProfileAlias"("profileId", "kind", "normalizedSourceValue", "contextKey");
CREATE INDEX "DeviceImportProfileAlias_profileId_idx" ON "DeviceImportProfileAlias"("profileId");
CREATE INDEX "DeviceImportProfileAlias_kind_targetId_idx" ON "DeviceImportProfileAlias"("kind", "targetId");
ALTER TABLE "DeviceImportProfileAlias" ADD CONSTRAINT "DeviceImportProfileAlias_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DeviceImportProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
