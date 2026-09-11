-- Issue #51: preserve logical stack topology while keeping Device as the operational target.
CREATE TABLE "DeviceTopology" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STACK',
    "provider" TEXT,
    "sourceAdapterId" TEXT,
    "sourceGroupKey" TEXT,
    "sourceMetadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceTopology_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceTopologyMember" (
    "id" TEXT NOT NULL,
    "topologyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT,
    "hostname" TEXT,
    "serialNumber" TEXT,
    "macAddress" TEXT,
    "deviceModelId" TEXT NOT NULL,
    "firmwareReleaseId" TEXT,
    "rawFirmwareVersion" TEXT,
    "rawSoftwareVersion" TEXT,
    "normalizedFirmwareVersion" TEXT,
    "firmwareEvidence" JSONB,
    "provider" TEXT,
    "sourceAdapterId" TEXT,
    "sourceId" TEXT,
    "sourceMetadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceTopologyMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceTopology_deviceId_key" ON "DeviceTopology"("deviceId");
CREATE INDEX "DeviceTopology_kind_idx" ON "DeviceTopology"("kind");
CREATE INDEX "DeviceTopology_provider_sourceGroupKey_idx" ON "DeviceTopology"("provider", "sourceGroupKey");
CREATE INDEX "DeviceTopology_lastSeenAt_idx" ON "DeviceTopology"("lastSeenAt");

CREATE UNIQUE INDEX "DeviceTopologyMember_topologyId_position_key" ON "DeviceTopologyMember"("topologyId", "position");
CREATE INDEX "DeviceTopologyMember_deviceModelId_idx" ON "DeviceTopologyMember"("deviceModelId");
CREATE INDEX "DeviceTopologyMember_firmwareReleaseId_idx" ON "DeviceTopologyMember"("firmwareReleaseId");
CREATE INDEX "DeviceTopologyMember_provider_sourceId_idx" ON "DeviceTopologyMember"("provider", "sourceId");
CREATE INDEX "DeviceTopologyMember_serialNumber_idx" ON "DeviceTopologyMember"("serialNumber");
CREATE INDEX "DeviceTopologyMember_macAddress_idx" ON "DeviceTopologyMember"("macAddress");
CREATE INDEX "DeviceTopologyMember_isActive_idx" ON "DeviceTopologyMember"("isActive");

ALTER TABLE "DeviceTopologyMember"
ADD CONSTRAINT "DeviceTopologyMember_topologyId_fkey"
FOREIGN KEY ("topologyId") REFERENCES "DeviceTopology"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
