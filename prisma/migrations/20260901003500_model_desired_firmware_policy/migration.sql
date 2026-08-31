-- Issue #9: one active model-baseline desired firmware policy per device model.
-- Historical rows remain available by setting isActive=false when policy changes or is cleared.
CREATE UNIQUE INDEX "FirmwarePolicy_active_model_baseline_key"
ON "FirmwarePolicy" ("deviceModelId")
WHERE "isActive" = true
  AND "deviceModelId" IS NOT NULL
  AND "customerId" IS NULL
  AND "contractTypeId" IS NULL
  AND "deviceId" IS NULL
  AND "vendorId" IS NULL
  AND "deviceTypeId" IS NULL;
