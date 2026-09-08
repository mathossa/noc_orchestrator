-- Issue #57 UX correction: DeviceModel.platform is the existing serialized
-- supported-platform field. Backfill it into generic broad compatibility
-- evidence. Once a model lists at least one supported platform, that selection
-- is authoritative for currently known same-vendor platforms.

WITH selected_platforms AS (
  SELECT DISTINCT
    model."id" AS "deviceModelId",
    model."vendorId" AS "vendorId",
    lower(btrim(platform_value)) AS "normalizedPlatform",
    btrim(platform_value) AS "platform"
  FROM "DeviceModel" AS model
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(model."platform", ''), '\s*,\s*') AS platform_value
  WHERE btrim(platform_value) <> ''
),
models_with_selection AS (
  SELECT DISTINCT "deviceModelId", "vendorId"
  FROM selected_platforms
),
known_vendor_platforms AS (
  SELECT
    source."vendorId",
    source."normalizedPlatform",
    min(source."platform") AS "platform"
  FROM (
    SELECT
      release."vendorId" AS "vendorId",
      lower(btrim(release."platform")) AS "normalizedPlatform",
      btrim(release."platform") AS "platform"
    FROM "FirmwareRelease" AS release
    WHERE btrim(release."platform") <> ''

    UNION ALL

    SELECT
      selected."vendorId",
      selected."normalizedPlatform",
      selected."platform"
    FROM selected_platforms AS selected
  ) AS source
  GROUP BY source."vendorId", source."normalizedPlatform"
),
desired_rules AS (
  SELECT
    model."deviceModelId",
    model."vendorId",
    known."normalizedPlatform",
    known."platform",
    CASE WHEN EXISTS (
      SELECT 1
      FROM selected_platforms AS selected
      WHERE selected."deviceModelId" = model."deviceModelId"
        AND selected."normalizedPlatform" = known."normalizedPlatform"
    ) THEN 'ALLOW' ELSE 'DENY' END AS "decision"
  FROM models_with_selection AS model
  JOIN known_vendor_platforms AS known
    ON known."vendorId" = model."vendorId"
)
UPDATE "FirmwareCompatibilityRule" AS rule
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
FROM models_with_selection AS model
WHERE rule."deviceModelId" = model."deviceModelId"
  AND rule."sourceType" = 'CONFIGURED_RULE'
  AND rule."firmwareTrainId" IS NULL
  AND rule."logicalVersion" IS NULL
  AND rule."firmwareReleaseId" IS NULL
  AND rule."imageCode" IS NULL
  AND rule."isActive" = true;

WITH selected_platforms AS (
  SELECT DISTINCT
    model."id" AS "deviceModelId",
    model."vendorId" AS "vendorId",
    lower(btrim(platform_value)) AS "normalizedPlatform",
    btrim(platform_value) AS "platform"
  FROM "DeviceModel" AS model
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(model."platform", ''), '\s*,\s*') AS platform_value
  WHERE btrim(platform_value) <> ''
),
models_with_selection AS (
  SELECT DISTINCT "deviceModelId", "vendorId"
  FROM selected_platforms
),
known_vendor_platforms AS (
  SELECT
    source."vendorId",
    source."normalizedPlatform",
    min(source."platform") AS "platform"
  FROM (
    SELECT
      release."vendorId" AS "vendorId",
      lower(btrim(release."platform")) AS "normalizedPlatform",
      btrim(release."platform") AS "platform"
    FROM "FirmwareRelease" AS release
    WHERE btrim(release."platform") <> ''

    UNION ALL

    SELECT
      selected."vendorId",
      selected."normalizedPlatform",
      selected."platform"
    FROM selected_platforms AS selected
  ) AS source
  GROUP BY source."vendorId", source."normalizedPlatform"
),
desired_rules AS (
  SELECT
    model."deviceModelId",
    model."vendorId",
    known."normalizedPlatform",
    known."platform",
    CASE WHEN EXISTS (
      SELECT 1
      FROM selected_platforms AS selected
      WHERE selected."deviceModelId" = model."deviceModelId"
        AND selected."normalizedPlatform" = known."normalizedPlatform"
    ) THEN 'ALLOW' ELSE 'DENY' END AS "decision"
  FROM models_with_selection AS model
  JOIN known_vendor_platforms AS known
    ON known."vendorId" = model."vendorId"
)
INSERT INTO "FirmwareCompatibilityRule" (
  "id",
  "vendorId",
  "deviceModelId",
  "platform",
  "decision",
  "sourceType",
  "explanation",
  "isActive"
)
SELECT
  'supported-platform-' || md5(desired."deviceModelId" || ':' || desired."normalizedPlatform" || ':' || desired."decision"),
  desired."vendorId",
  desired."deviceModelId",
  desired."platform",
  desired."decision",
  'CONFIGURED_RULE',
  CASE
    WHEN desired."decision" = 'ALLOW' THEN 'Supported platform selected on the device model.'
    ELSE 'Platform is not selected as supported on the device model.'
  END,
  true
FROM desired_rules AS desired;
