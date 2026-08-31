-- Core NOC Orchestrator domain model for Issue #2.
-- Technical firmware/compliance state remains derived and is intentionally not persisted.

CREATE TYPE "FirmwareWorkflowState" AS ENUM ('PLANNED', 'IGNORED', 'CUSTOMER_DECLINED', 'DONE');

CREATE TABLE "ContractType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "contractTypeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalProvider" TEXT,
    "externalId" TEXT,
    "lastSynchronizedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceModel" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "deviceTypeId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "platform" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalProvider" TEXT,
    "externalId" TEXT,
    "lastSynchronizedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwareRelease" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "filename" TEXT,
    "sha256" TEXT,
    "fileSizeBytes" BIGINT,
    "releaseNotesUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "releasedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalProvider" TEXT,
    "externalId" TEXT,
    "lastSynchronizedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FirmwareRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deviceModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "serialNumber" TEXT,
    "managementAddress" TEXT,
    "currentFirmwareReleaseId" TEXT,
    "currentFirmwareObservedAt" TIMESTAMP(3),
    "currentFirmwareSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalProvider" TEXT,
    "externalId" TEXT,
    "lastSynchronizedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwarePolicy" (
    "id" TEXT NOT NULL,
    "targetFirmwareReleaseId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "deviceModelId" TEXT,
    "customerId" TEXT,
    "contractTypeId" TEXT,
    "deviceId" TEXT,
    "vendorId" TEXT,
    "deviceTypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FirmwarePolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwareLifecycleRecord" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "targetFirmwareReleaseId" TEXT NOT NULL,
    "state" "FirmwareWorkflowState" NOT NULL,
    "reason" TEXT,
    "plannedFor" TIMESTAMP(3),
    "reviewAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FirmwareLifecycleRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "customerId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractType_code_key" ON "ContractType"("code");
CREATE UNIQUE INDEX "ContractType_name_key" ON "ContractType"("name");
CREATE INDEX "ContractType_isActive_idx" ON "ContractType"("isActive");

CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");
CREATE INDEX "Vendor_isActive_idx" ON "Vendor"("isActive");

CREATE UNIQUE INDEX "DeviceType_code_key" ON "DeviceType"("code");
CREATE UNIQUE INDEX "DeviceType_name_key" ON "DeviceType"("name");
CREATE INDEX "DeviceType_isActive_idx" ON "DeviceType"("isActive");

CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");
CREATE INDEX "Customer_externalProvider_externalId_idx" ON "Customer"("externalProvider", "externalId");
CREATE INDEX "Customer_contractTypeId_idx" ON "Customer"("contractTypeId");
CREATE INDEX "Customer_source_idx" ON "Customer"("source");
CREATE INDEX "Customer_isActive_idx" ON "Customer"("isActive");
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

CREATE UNIQUE INDEX "DeviceModel_vendorId_model_key" ON "DeviceModel"("vendorId", "model");
CREATE INDEX "DeviceModel_externalProvider_externalId_idx" ON "DeviceModel"("externalProvider", "externalId");
CREATE INDEX "DeviceModel_vendorId_idx" ON "DeviceModel"("vendorId");
CREATE INDEX "DeviceModel_deviceTypeId_idx" ON "DeviceModel"("deviceTypeId");
CREATE INDEX "DeviceModel_platform_idx" ON "DeviceModel"("platform");
CREATE INDEX "DeviceModel_source_idx" ON "DeviceModel"("source");
CREATE INDEX "DeviceModel_isActive_idx" ON "DeviceModel"("isActive");

CREATE UNIQUE INDEX "FirmwareRelease_vendorId_platform_version_key" ON "FirmwareRelease"("vendorId", "platform", "version");
CREATE INDEX "FirmwareRelease_externalProvider_externalId_idx" ON "FirmwareRelease"("externalProvider", "externalId");
CREATE INDEX "FirmwareRelease_vendorId_idx" ON "FirmwareRelease"("vendorId");
CREATE INDEX "FirmwareRelease_version_idx" ON "FirmwareRelease"("version");
CREATE INDEX "FirmwareRelease_status_idx" ON "FirmwareRelease"("status");
CREATE INDEX "FirmwareRelease_source_idx" ON "FirmwareRelease"("source");

CREATE UNIQUE INDEX "Device_customerId_name_key" ON "Device"("customerId", "name");
CREATE INDEX "Device_customerId_serialNumber_idx" ON "Device"("customerId", "serialNumber");
CREATE INDEX "Device_externalProvider_externalId_idx" ON "Device"("externalProvider", "externalId");
CREATE INDEX "Device_customerId_idx" ON "Device"("customerId");
CREATE INDEX "Device_deviceModelId_idx" ON "Device"("deviceModelId");
CREATE INDEX "Device_currentFirmwareReleaseId_idx" ON "Device"("currentFirmwareReleaseId");
CREATE INDEX "Device_currentFirmwareSource_idx" ON "Device"("currentFirmwareSource");
CREATE INDEX "Device_source_idx" ON "Device"("source");
CREATE INDEX "Device_isActive_idx" ON "Device"("isActive");
CREATE INDEX "Device_hostname_idx" ON "Device"("hostname");

CREATE INDEX "FirmwarePolicy_targetFirmwareReleaseId_idx" ON "FirmwarePolicy"("targetFirmwareReleaseId");
CREATE INDEX "FirmwarePolicy_deviceModelId_isActive_idx" ON "FirmwarePolicy"("deviceModelId", "isActive");
CREATE INDEX "FirmwarePolicy_customerId_idx" ON "FirmwarePolicy"("customerId");
CREATE INDEX "FirmwarePolicy_contractTypeId_idx" ON "FirmwarePolicy"("contractTypeId");
CREATE INDEX "FirmwarePolicy_deviceId_idx" ON "FirmwarePolicy"("deviceId");
CREATE INDEX "FirmwarePolicy_vendorId_idx" ON "FirmwarePolicy"("vendorId");
CREATE INDEX "FirmwarePolicy_deviceTypeId_idx" ON "FirmwarePolicy"("deviceTypeId");
CREATE INDEX "FirmwarePolicy_isActive_idx" ON "FirmwarePolicy"("isActive");

CREATE UNIQUE INDEX "FirmwareLifecycleRecord_deviceId_key" ON "FirmwareLifecycleRecord"("deviceId");
CREATE INDEX "FirmwareLifecycleRecord_state_idx" ON "FirmwareLifecycleRecord"("state");
CREATE INDEX "FirmwareLifecycleRecord_targetFirmwareReleaseId_idx" ON "FirmwareLifecycleRecord"("targetFirmwareReleaseId");
CREATE INDEX "FirmwareLifecycleRecord_decidedByUserId_idx" ON "FirmwareLifecycleRecord"("decidedByUserId");
CREATE INDEX "FirmwareLifecycleRecord_plannedFor_idx" ON "FirmwareLifecycleRecord"("plannedFor");
CREATE INDEX "FirmwareLifecycleRecord_reviewAt_idx" ON "FirmwareLifecycleRecord"("reviewAt");

CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");
CREATE INDEX "AuditEvent_customerId_idx" ON "AuditEvent"("customerId");
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_contractTypeId_fkey"
FOREIGN KEY ("contractTypeId") REFERENCES "ContractType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceModel"
ADD CONSTRAINT "DeviceModel_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceModel"
ADD CONSTRAINT "DeviceModel_deviceTypeId_fkey"
FOREIGN KEY ("deviceTypeId") REFERENCES "DeviceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwareRelease"
ADD CONSTRAINT "FirmwareRelease_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device"
ADD CONSTRAINT "Device_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device"
ADD CONSTRAINT "Device_deviceModelId_fkey"
FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device"
ADD CONSTRAINT "Device_currentFirmwareReleaseId_fkey"
FOREIGN KEY ("currentFirmwareReleaseId") REFERENCES "FirmwareRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_targetFirmwareReleaseId_fkey"
FOREIGN KEY ("targetFirmwareReleaseId") REFERENCES "FirmwareRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_deviceModelId_fkey"
FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_contractTypeId_fkey"
FOREIGN KEY ("contractTypeId") REFERENCES "ContractType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwarePolicy"
ADD CONSTRAINT "FirmwarePolicy_deviceTypeId_fkey"
FOREIGN KEY ("deviceTypeId") REFERENCES "DeviceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwareLifecycleRecord"
ADD CONSTRAINT "FirmwareLifecycleRecord_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FirmwareLifecycleRecord"
ADD CONSTRAINT "FirmwareLifecycleRecord_targetFirmwareReleaseId_fkey"
FOREIGN KEY ("targetFirmwareReleaseId") REFERENCES "FirmwareRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FirmwareLifecycleRecord"
ADD CONSTRAINT "FirmwareLifecycleRecord_decidedByUserId_fkey"
FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
