-- Issue #57: vendor-neutral firmware compatibility evidence and reversible manual overrides.

CREATE TABLE "FirmwareCompatibilityRule" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "deviceModelFamilyId" TEXT,
    "deviceModelId" TEXT,
    "platform" TEXT NOT NULL,
    "firmwareTrainId" TEXT,
    "logicalVersion" TEXT,
    "firmwareReleaseId" TEXT,
    "imageCode" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'ALLOW',
    "sourceType" TEXT NOT NULL DEFAULT 'CATALOG',
    "explanation" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FirmwareCompatibilityRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FirmwareCompatibilityRule_subject_check" CHECK (
        (("deviceModelFamilyId" IS NOT NULL)::int + ("deviceModelId" IS NOT NULL)::int) = 1
    ),
    CONSTRAINT "FirmwareCompatibilityRule_decision_check" CHECK ("decision" IN ('ALLOW', 'DENY')),
    CONSTRAINT "FirmwareCompatibilityRule_sourceType_check" CHECK ("sourceType" IN ('CATALOG', 'CONFIGURED_RULE')),
    CONSTRAINT "FirmwareCompatibilityRule_validity_check" CHECK (
        "validFrom" IS NULL OR "validUntil" IS NULL OR "validUntil" > "validFrom"
    )
);

CREATE TABLE "FirmwareCompatibilityOverride" (
    "id" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "firmwareReleaseId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FirmwareCompatibilityOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FirmwareCompatibilityOverride_decision_check" CHECK ("decision" IN ('ALLOW', 'DENY')),
    CONSTRAINT "FirmwareCompatibilityOverride_version_check" CHECK ("version" > 0),
    CONSTRAINT "FirmwareCompatibilityOverride_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "FirmwareCompatibilityRule_vendorId_isActive_idx" ON "FirmwareCompatibilityRule"("vendorId", "isActive");
CREATE INDEX "FirmwareCompatibilityRule_deviceModelFamilyId_isActive_idx" ON "FirmwareCompatibilityRule"("deviceModelFamilyId", "isActive");
CREATE INDEX "FirmwareCompatibilityRule_deviceModelId_isActive_idx" ON "FirmwareCompatibilityRule"("deviceModelId", "isActive");
CREATE INDEX "FirmwareCompatibilityRule_platform_isActive_idx" ON "FirmwareCompatibilityRule"("platform", "isActive");
CREATE INDEX "FirmwareCompatibilityRule_firmwareTrainId_idx" ON "FirmwareCompatibilityRule"("firmwareTrainId");
CREATE INDEX "FirmwareCompatibilityRule_logicalVersion_idx" ON "FirmwareCompatibilityRule"("logicalVersion");
CREATE INDEX "FirmwareCompatibilityRule_firmwareReleaseId_idx" ON "FirmwareCompatibilityRule"("firmwareReleaseId");
CREATE INDEX "FirmwareCompatibilityRule_imageCode_idx" ON "FirmwareCompatibilityRule"("imageCode");
CREATE INDEX "FirmwareCompatibilityRule_sourceType_isActive_idx" ON "FirmwareCompatibilityRule"("sourceType", "isActive");

CREATE UNIQUE INDEX "FirmwareCompatibilityOverride_deviceModelId_firmwareReleaseId_version_key"
ON "FirmwareCompatibilityOverride"("deviceModelId", "firmwareReleaseId", "version");
CREATE INDEX "FirmwareCompatibilityOverride_deviceModelId_firmwareReleaseId_isActive_idx"
ON "FirmwareCompatibilityOverride"("deviceModelId", "firmwareReleaseId", "isActive");
CREATE INDEX "FirmwareCompatibilityOverride_createdByUserId_idx"
ON "FirmwareCompatibilityOverride"("createdByUserId");
