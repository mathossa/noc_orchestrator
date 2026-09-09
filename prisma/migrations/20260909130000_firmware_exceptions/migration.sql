CREATE TABLE "FirmwareException" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "notes" TEXT,
    "releaseId" TEXT,
    "vendorId" TEXT,
    "platform" TEXT,
    "minimumVersion" TEXT,
    "maximumVersion" TEXT,
    "trainId" TEXT,
    "fromPlatform" TEXT,
    "toPlatform" TEXT,
    "duration" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "policySnapshots" JSONB NOT NULL,
    "actorUserId" TEXT,
    "contactReference" TEXT,
    "ticketReference" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededByUserId" TEXT,
    "legacyLifecycleId" TEXT,
    "legacyEvidence" JSONB,

    CONSTRAINT "FirmwareException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirmwareExceptionReason" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "replacementRelated" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FirmwareExceptionReason_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX "FirmwareException_legacyLifecycleId_key" ON "FirmwareException"("legacyLifecycleId");

CREATE INDEX "FirmwareException_scope_scopeId_supersededAt_idx" ON "FirmwareException"("scope", "scopeId", "supersededAt");

CREATE INDEX "FirmwareException_expiresAt_idx" ON "FirmwareException"("expiresAt");

CREATE INDEX "FirmwareException_reasonCode_idx" ON "FirmwareException"("reasonCode");

INSERT INTO "FirmwareExceptionReason" ("code", "label", "replacementRelated") VALUES
('CUSTOMER_DECLINED', 'Customer declined', false),
('NO_OPERATIONAL_BENEFIT', 'No operational benefit', false),
('COMPATIBILITY', 'Application or integration compatibility', false),
('MAINTENANCE_UNAVAILABLE', 'Maintenance unavailable', false),
('TECHNICAL_BLOCKER', 'Temporary technical blocker', false),
('VENDOR_RECOMMENDATION', 'Vendor recommendation', false),
('REPLACEMENT_SCHEDULED', 'Device scheduled for replacement', true),
('EOL', 'End of life / replacement required', true),
('ENGINEER_DEVIATION', 'Engineer-approved deviation', false),
('OTHER', 'Other', false);

-- Preserve the entire old row, including all timestamps and actor, before
-- moving only exception decisions out of the one-row planning projection.
-- Existing AuditEvent records and PLANNED/DONE rows remain untouched.
INSERT INTO "FirmwareException" (
 "id", "scope", "scopeId", "scopeLabel", "subject", "reasonCode", "notes",
 "releaseId", "duration", "expiresAt", "policySnapshots", "actorUserId",
 "decidedAt", "legacyLifecycleId", "legacyEvidence"
)
SELECT 'legacy-' || l."id", 'DEVICE', l."deviceId", d."name", 'RELEASE',
 CASE WHEN l."state" = 'CUSTOMER_DECLINED' THEN 'CUSTOMER_DECLINED' ELSE 'ENGINEER_DEVIATION' END,
 concat_ws(E'\n', l."reason", l."notes"), l."targetFirmwareReleaseId",
 CASE WHEN l."reviewAt" IS NULL THEN 'PERMANENT' ELSE 'CUSTOM_DATE' END,
 l."reviewAt", '{}'::jsonb, l."decidedByUserId", l."decidedAt", l."id", to_jsonb(l)
FROM "FirmwareLifecycleRecord" l JOIN "Device" d ON d."id" = l."deviceId"
WHERE l."state" IN ('IGNORED', 'CUSTOMER_DECLINED');

DELETE FROM "FirmwareLifecycleRecord" l USING "FirmwareException" e
WHERE e."legacyLifecycleId" = l."id" AND l."state" IN ('IGNORED', 'CUSTOMER_DECLINED');
