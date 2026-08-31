-- Issue #4: configurable reference data.
-- Name uniqueness is normalized as Unicode-normalized in application code,
-- trimmed/collapsed whitespace, and case-insensitive in PostgreSQL.

ALTER TABLE "ContractType"
ADD COLUMN "firmwareManagementEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Vendor_name_normalized_key"
ON "Vendor" ((lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))));

CREATE UNIQUE INDEX "DeviceType_name_normalized_key"
ON "DeviceType" ((lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))));

CREATE UNIQUE INDEX "ContractType_name_normalized_key"
ON "ContractType" ((lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))));
