-- Issue #6: device model identity belongs to a vendor.
-- Keep the model label as entered, but prevent case/whitespace variants of the
-- same model from being created for the same vendor.

CREATE UNIQUE INDEX "DeviceModel_vendor_model_normalized_key"
ON "DeviceModel" (
  "vendorId",
  (lower(regexp_replace(btrim("model"), '[[:space:]]+', ' ', 'g')))
);
