CREATE TABLE "FirmwareWorkPlan" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROPOSED',
    "title" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "externalReference" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "maintenanceWindowReference" TEXT,
    "upgradeCapability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "legacyLifecycleId" TEXT,
    "legacyEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmwareWorkPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwareWorkPlanTarget" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "siteId" TEXT,
    "siteName" TEXT,
    "deviceModelId" TEXT NOT NULL,
    "deviceModelName" TEXT NOT NULL,
    "logicalGroupKey" TEXT,
    "observedFirmwareReleaseId" TEXT,
    "observedFirmwareVersion" TEXT,
    "observedFirmwareRawVersion" TEXT,
    "observedFirmwareFingerprint" TEXT,
    "observedAt" TIMESTAMP(3),
    "policyId" TEXT,
    "policyScope" TEXT,
    "policyTrackKey" TEXT,
    "policyTrackName" TEXT,
    "policyVersion" INTEGER,
    "policyFingerprint" TEXT,
    "recommendation" TEXT NOT NULL,
    "preferredTargetFirmwareReleaseId" TEXT,
    "preferredTargetVersion" TEXT,
    "targetFirmwareReleaseId" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "targetLogicalVersion" TEXT NOT NULL,
    "targetPlatform" TEXT NOT NULL,
    "targetVariant" TEXT,
    "targetImageCode" TEXT,
    "compatibilityStatus" TEXT,
    "exceptionOverride" BOOLEAN NOT NULL DEFAULT false,
    "exceptionSnapshot" JSONB,
    "memberSnapshot" JSONB,
    "upgradeCapability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmwareWorkPlanTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwareWorkPlanEvent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "targetId" TEXT,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmwareWorkPlanEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirmwareWorkPlan_legacyLifecycleId_key" ON "FirmwareWorkPlan"("legacyLifecycleId");
CREATE INDEX "FirmwareWorkPlan_state_scheduledFor_idx" ON "FirmwareWorkPlan"("state", "scheduledFor");
CREATE INDEX "FirmwareWorkPlan_createdByUserId_idx" ON "FirmwareWorkPlan"("createdByUserId");
CREATE INDEX "FirmwareWorkPlan_completedAt_idx" ON "FirmwareWorkPlan"("completedAt");

CREATE UNIQUE INDEX "FirmwareWorkPlanTarget_planId_deviceId_key" ON "FirmwareWorkPlanTarget"("planId", "deviceId");
CREATE INDEX "FirmwareWorkPlanTarget_deviceId_idx" ON "FirmwareWorkPlanTarget"("deviceId");
CREATE INDEX "FirmwareWorkPlanTarget_customerId_idx" ON "FirmwareWorkPlanTarget"("customerId");
CREATE INDEX "FirmwareWorkPlanTarget_siteId_idx" ON "FirmwareWorkPlanTarget"("siteId");
CREATE INDEX "FirmwareWorkPlanTarget_deviceModelId_idx" ON "FirmwareWorkPlanTarget"("deviceModelId");
CREATE INDEX "FirmwareWorkPlanTarget_targetFirmwareReleaseId_idx" ON "FirmwareWorkPlanTarget"("targetFirmwareReleaseId");

CREATE INDEX "FirmwareWorkPlanEvent_planId_createdAt_idx" ON "FirmwareWorkPlanEvent"("planId", "createdAt");
CREATE INDEX "FirmwareWorkPlanEvent_targetId_idx" ON "FirmwareWorkPlanEvent"("targetId");
CREATE INDEX "FirmwareWorkPlanEvent_actorUserId_idx" ON "FirmwareWorkPlanEvent"("actorUserId");

ALTER TABLE "FirmwareWorkPlanTarget"
ADD CONSTRAINT "FirmwareWorkPlanTarget_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "FirmwareWorkPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FirmwareWorkPlanEvent"
ADD CONSTRAINT "FirmwareWorkPlanEvent_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "FirmwareWorkPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the old PLANNED/DONE row as migration evidence. We deliberately do
-- not invent approval history that the legacy model never captured.
-- PLANNED with an explicit date becomes SCHEDULED; undated PLANNED becomes
-- PROPOSED. DONE stays terminal historical work.
INSERT INTO "FirmwareWorkPlan" (
    "id", "state", "reason", "notes", "scheduledFor", "upgradeCapability",
    "createdByUserId", "scheduledAt", "completedAt", "legacyLifecycleId",
    "legacyEvidence", "createdAt", "updatedAt"
)
SELECT
    'legacy-plan-' || l."id",
    CASE
        WHEN l."state" = 'DONE' THEN 'DONE'
        WHEN l."plannedFor" IS NOT NULL THEN 'SCHEDULED'
        ELSE 'PROPOSED'
    END,
    l."reason",
    l."notes",
    l."plannedFor",
    'UNKNOWN',
    l."decidedByUserId",
    CASE WHEN l."state" = 'PLANNED' AND l."plannedFor" IS NOT NULL THEN l."decidedAt" ELSE NULL END,
    CASE WHEN l."state" = 'DONE' THEN COALESCE(l."completedAt", l."decidedAt") ELSE NULL END,
    l."id",
    to_jsonb(l),
    l."createdAt",
    l."updatedAt"
FROM "FirmwareLifecycleRecord" l
WHERE l."state" IN ('PLANNED', 'DONE')
ON CONFLICT ("legacyLifecycleId") DO NOTHING;

-- Snapshot every recoverable planning assumption. Recommendation/policy and
-- compatibility were not stored by the legacy lifecycle model, so they are
-- explicitly marked unknown instead of being reconstructed from today's state.
INSERT INTO "FirmwareWorkPlanTarget" (
    "id", "planId", "deviceId", "deviceName", "customerId", "customerName",
    "siteId", "siteName", "deviceModelId", "deviceModelName",
    "observedFirmwareReleaseId", "observedFirmwareVersion",
    "observedFirmwareRawVersion", "observedFirmwareFingerprint", "observedAt",
    "recommendation", "preferredTargetFirmwareReleaseId", "preferredTargetVersion",
    "targetFirmwareReleaseId", "targetVersion", "targetLogicalVersion",
    "targetPlatform", "targetVariant", "targetImageCode", "compatibilityStatus",
    "exceptionOverride", "upgradeCapability", "createdAt"
)
SELECT
    'legacy-target-' || l."id",
    p."id",
    d."id",
    d."name",
    d."customerId",
    c."name",
    d."siteId",
    s."name",
    d."deviceModelId",
    dm."model",
    d."currentFirmwareReleaseId",
    COALESCE(current_release."version", d."currentFirmwareNormalizedVersion", d."currentFirmwareRawVersion"),
    d."currentFirmwareRawVersion",
    CASE
      WHEN d."currentFirmwareReleaseId" IS NULL
       AND d."currentFirmwareNormalizedVersion" IS NULL
       AND d."currentFirmwareRawVersion" IS NULL
       AND d."currentFirmwareObservedAt" IS NULL
      THEN NULL
      ELSE concat_ws('|',
        d."currentFirmwareReleaseId",
        d."currentFirmwareNormalizedVersion",
        d."currentFirmwareRawVersion",
        d."currentFirmwareObservedAt"::text
      )
    END,
    d."currentFirmwareObservedAt",
    'UNKNOWN_LEGACY',
    l."targetFirmwareReleaseId",
    target_release."version",
    l."targetFirmwareReleaseId",
    target_release."version",
    target_release."logicalVersion",
    target_release."platform",
    target_release."variant",
    target_release."imageCode",
    'UNKNOWN_LEGACY',
    false,
    'UNKNOWN',
    l."createdAt"
FROM "FirmwareLifecycleRecord" l
JOIN "FirmwareWorkPlan" p ON p."legacyLifecycleId" = l."id"
JOIN "Device" d ON d."id" = l."deviceId"
JOIN "Customer" c ON c."id" = d."customerId"
LEFT JOIN "Site" s ON s."id" = d."siteId"
JOIN "DeviceModel" dm ON dm."id" = d."deviceModelId"
JOIN "FirmwareRelease" target_release ON target_release."id" = l."targetFirmwareReleaseId"
LEFT JOIN "FirmwareRelease" current_release ON current_release."id" = d."currentFirmwareReleaseId"
WHERE l."state" IN ('PLANNED', 'DONE')
ON CONFLICT ("planId", "deviceId") DO NOTHING;

-- One migration event records the legacy state without fabricating intermediate
-- transitions. Existing AuditEvent history remains available as the detailed
-- pre-#60 audit trail.
INSERT INTO "FirmwareWorkPlanEvent" (
    "id", "planId", "targetId", "fromState", "toState", "actorUserId",
    "reason", "notes", "metadata", "createdAt"
)
SELECT
    'legacy-event-' || l."id",
    p."id",
    'legacy-target-' || l."id",
    NULL,
    p."state",
    l."decidedByUserId",
    l."reason",
    l."notes",
    jsonb_build_object(
        'migratedFrom', 'FirmwareLifecycleRecord',
        'legacyLifecycleId', l."id",
        'legacyState', l."state"::text,
        'reviewAt', l."reviewAt"
    ),
    l."decidedAt"
FROM "FirmwareLifecycleRecord" l
JOIN "FirmwareWorkPlan" p ON p."legacyLifecycleId" = l."id"
WHERE l."state" IN ('PLANNED', 'DONE')
ON CONFLICT ("id") DO NOTHING;

-- Keep the legacy PLANNED/DONE rows during the #60 transition so current UI/API
-- code remains backward compatible until it is switched to FirmwareWorkPlan.
-- #59 already removed IGNORED/CUSTOMER_DECLINED from this legacy projection.
