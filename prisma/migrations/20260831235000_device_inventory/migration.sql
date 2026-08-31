-- Issue #8: manual device inventory.
-- Add device notes and prevent case/whitespace variants of the same device
-- name from being created for one customer.

ALTER TABLE "Device"
ADD COLUMN "notes" TEXT;

CREATE UNIQUE INDEX "Device_customer_name_normalized_key"
ON "Device" (
  "customerId",
  (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')))
);
