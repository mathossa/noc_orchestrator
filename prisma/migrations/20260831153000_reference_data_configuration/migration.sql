-- Issue #4: configurable reference data.
-- Name uniqueness trims/collapses whitespace and compares case-insensitively.

ALTER TABLE "ContractType"
ADD COLUMN "firmwareManagementEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Vendor_name_normalized_key"
ON "Vendor" ((lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))));

CREATE UNIQUE INDEX "DeviceType_name_normalized_key"
ON "DeviceType" ((lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))));

CREATE UNIQUE INDEX "ContractType_name_normalized_key"
ON "ContractType" ((lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))));
